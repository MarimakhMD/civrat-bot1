"use strict";

const { SecurityRaidService } = require("../services/SecurityRaidService");
const { SecurityBotService } = require("../services/SecurityBotService");
const { SecurityNukeService } = require("../services/SecurityNukeService");
const { SecurityAlertSuppression } = require("../services/SecurityAlertSuppression");
const { DiscordSecurityTransport } = require("../../../adapters/discord/DiscordSecurityTransport");

/**
 * Creates Security runtime wiring raid/bot/nuke detection with transport and logs.
 * All services are transport-neutral; Discord and Logs are injected.
 *
 * PHASE 1 — deux corrections :
 *  • ANTI-SPAM : une détection de raid/nuke est un état, pas un événement. Sans
 *    suppression, chaque arrivée au-delà du seuil produisait un embed
 *    identique (16 embeds pour un raid de 20 membres). Une seule alerte est
 *    désormais émise par `(guild_id, action)` et par fenêtre de détection.
 *  • OBSERVABILITÉ : les six `catch {}` vides avalaient toute erreur de
 *    journalisation sans laisser la moindre trace.
 */
function createSecurityRuntime({
  configService,
  raidService,
  botService,
  nukeService,
  alertSuppression,
  transportFactory,
  logsRuntimeFactory,
  logger = null,
} = {}) {
  if (!configService || typeof configService.read !== "function") {
    throw new TypeError("createSecurityRuntime requires configService.");
  }
  const raid = raidService || new SecurityRaidService();
  const bot = botService || new SecurityBotService();
  const nuke = nukeService || new SecurityNukeService();
  const suppression = alertSuppression || new SecurityAlertSuppression();
  const makeTransport = typeof transportFactory === "function" ? transportFactory : (guild) => new DiscordSecurityTransport({ guild });
  const makeLogs = typeof logsRuntimeFactory === "function" ? logsRuntimeFactory : () => null;
  const log = logger || require("../../../utils/logger");

  /**
   * Émet une alerte Security, au plus une fois par `(guild_id, action)` et par
   * fenêtre de détection. Retourne `true` si l'alerte a réellement été émise.
   */
  async function emitAlert({ guild, action, windowMs, payload }) {
    if (!suppression.shouldAlert(`${guild.id}:${action}`, windowMs)) return false;

    const logs = makeLogs();
    if (!logs || logs.disabled) return false;

    try {
      await logs.handleModerationEvent({ guild, ...payload });
      return true;
    } catch (error) {
      // Best-effort conservé, mais désormais visible : une alerte perdue
      // silencieusement est indiscernable d'une absence de menace.
      log?.warn?.("Security alert log failed", {
        event: "security_alert_log_failed",
        guildId: guild?.id || null,
        action,
        error: error?.message || String(error),
      });
      return false;
    }
  }

  return Object.freeze({
    handleMemberJoined: async (member) => {
      const guild = member && member.guild;
      if (!guild) return { handled: false, code: "GUILD_MISSING" };
      const config = await configService.read(guild.id);
      if (!config || !config.security_enabled) return { handled: false, code: "SECURITY_DISABLED" };

      const results = { raid: null, bot: null, logged: [] };

      // Anti-raid
      if (config.security_anti_raid) {
        const raidResult = raid.record(guild.id);
        results.raid = raidResult;
        if (raidResult.isRaid) {
          const alerted = await emitAlert({
            guild,
            action: "security_raid",
            windowMs: raidResult.windowMs,
            payload: {
              action: "security_raid",
              targetId: member.id,
              reason: `Raid: ${raidResult.count}/${raidResult.threshold} in ${raidResult.windowMs}ms`,
              rule: "SECURITY_RAID",
              rules: ["SECURITY_RAID"],
            },
          });
          if (alerted) results.logged.push("security_raid");
        }
      }

      // Anti-bot / whitelist
      if (member.user && config.security_anti_bot) {
        const botResult = bot.check({ isBot: Boolean(member.user.bot), userId: member.id, config });
        results.bot = botResult;
        if (!botResult.allowed) {
          const alerted = await emitAlert({
            guild,
            action: "security_bot",
            // Un bot non autorisé est un cas ponctuel, pas un état répété :
            // aucune suppression ici, chaque bot entrant est signalé.
            windowMs: 0,
            payload: {
              action: "security_bot",
              targetId: member.id,
              reason: `Bot not whitelisted: ${member.id}`,
              rule: "SECURITY_BOT",
              rules: ["SECURITY_BOT"],
            },
          });
          if (alerted) results.logged.push("security_bot");
        }
      }

      return { handled: true, ...results };
    },

    handleChannelCreate: async (channel) => {
      const guild = channel && channel.guild;
      if (!guild) return { handled: false, code: "GUILD_MISSING" };
      const config = await configService.read(guild.id);
      if (!config || !config.security_enabled || !config.security_anti_nuke) return { handled: false, code: "SECURITY_DISABLED" };
      const result = nuke.record({ guildId: guild.id, action: "channelCreate" });
      if (result.isNuke) {
        await emitAlert({
          guild,
          action: `security_nuke:channelCreate`,
          windowMs: result.windowMs,
          payload: {
            action: "security_nuke",
            targetId: null,
            reason: `Nuke channelCreate ${result.count}/${result.threshold}`,
            rule: "SECURITY_NUKE_CHANNEL_CREATE",
            rules: ["SECURITY_NUKE"],
          },
        });
      }
      return { handled: true, nuke: result };
    },

    handleChannelDelete: async (channel) => {
      const guild = channel && channel.guild;
      if (!guild) return { handled: false, code: "GUILD_MISSING" };
      const config = await configService.read(guild.id);
      if (!config || !config.security_enabled || !config.security_anti_nuke) return { handled: false, code: "SECURITY_DISABLED" };
      const result = nuke.record({ guildId: guild.id, action: "channelDelete" });
      if (result.isNuke) {
        await emitAlert({
          guild,
          action: `security_nuke:channelDelete`,
          windowMs: result.windowMs,
          payload: {
            action: "security_nuke",
            targetId: null,
            reason: `Nuke channelDelete ${result.count}/${result.threshold}`,
            rule: "SECURITY_NUKE_CHANNEL_DELETE",
            rules: ["SECURITY_NUKE"],
          },
        });
      }
      return { handled: true, nuke: result };
    },

    handleRoleCreate: async (role) => {
      const guild = role && role.guild;
      if (!guild) return { handled: false, code: "GUILD_MISSING" };
      const config = await configService.read(guild.id);
      if (!config || !config.security_enabled || !config.security_anti_nuke) return { handled: false, code: "SECURITY_DISABLED" };
      const result = nuke.record({ guildId: guild.id, action: "roleCreate" });
      if (result.isNuke) {
        await emitAlert({
          guild,
          action: `security_nuke:roleCreate`,
          windowMs: result.windowMs,
          payload: {
            action: "security_nuke",
            targetId: null,
            reason: `Nuke roleCreate ${result.count}/${result.threshold}`,
            rule: "SECURITY_NUKE_ROLE_CREATE",
            rules: ["SECURITY_NUKE"],
          },
        });
      }
      return { handled: true, nuke: result };
    },

    handleRoleDelete: async (role) => {
      const guild = role && role.guild;
      if (!guild) return { handled: false, code: "GUILD_MISSING" };
      const config = await configService.read(guild.id);
      if (!config || !config.security_enabled || !config.security_anti_nuke) return { handled: false, code: "SECURITY_DISABLED" };
      const result = nuke.record({ guildId: guild.id, action: "roleDelete" });
      if (result.isNuke) {
        await emitAlert({
          guild,
          action: `security_nuke:roleDelete`,
          windowMs: result.windowMs,
          payload: {
            action: "security_nuke",
            targetId: null,
            reason: `Nuke roleDelete ${result.count}/${result.threshold}`,
            rule: "SECURITY_NUKE_ROLE_DELETE",
            rules: ["SECURITY_NUKE"],
          },
        });
      }
      return { handled: true, nuke: result };
    },

    // Expose services for testing
    _raid: raid,
    _bot: bot,
    _nuke: nuke,
    _suppression: suppression,
  });
}

module.exports = { createSecurityRuntime };
