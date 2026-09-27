"use strict";

const { SecurityRaidService } = require("../services/SecurityRaidService");
const { SecurityBotService } = require("../services/SecurityBotService");
const { SecurityNukeService } = require("../services/SecurityNukeService");
const { SecurityAlertSuppression } = require("../services/SecurityAlertSuppression");
const { SecurityPermsService, gainedSensitivePermissions } = require("../services/SecurityPermsService");
const { SecurityPermsDefaults } = require("../configuration/securityConstants");
const { DiscordSecurityTransport } = require("../../../adapters/discord/DiscordSecurityTransport");
const { channelLabel, roleLabel } = require("../../logs/services/logLabels");

// P2-A — champs acteur informatifs pour les alertes nuke. Fail-closed : si
// l'Audit Log n'a pas permis d'identifier l'auteur, on transmet `null`, jamais
// une valeur inventée. Réutilise le système de label existant (logLabels).
function actorFields(actor) {
  return { actorId: (actor && actor.executorId) || null, actor: (actor && actor.executor) || null };
}

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
  permsService,
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
  const perms = permsService || new SecurityPermsService();
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

    // P2-A — l'acteur est résolu UNE SEULE FOIS par l'événement (Audit Log) et
    // partagé ici ; aucun second resolve (qui échouerait sur l'entrée consommée).
    handleChannelCreate: async (channel, actor) => {
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
            subtype: "channelCreate",
            ...actorFields(actor),
            targetId: channel.id || null,
            target: channelLabel(channel),
            reason: `Nuke channelCreate ${result.count}/${result.threshold}`,
            rule: "SECURITY_NUKE_CHANNEL_CREATE",
            rules: ["SECURITY_NUKE"],
          },
        });
      }
      return { handled: true, nuke: result };
    },

    handleChannelDelete: async (channel, actor) => {
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
            subtype: "channelDelete",
            ...actorFields(actor),
            targetId: channel.id || null,
            target: channelLabel(channel),
            reason: `Nuke channelDelete ${result.count}/${result.threshold}`,
            rule: "SECURITY_NUKE_CHANNEL_DELETE",
            rules: ["SECURITY_NUKE"],
          },
        });
      }
      return { handled: true, nuke: result };
    },

    handleRoleCreate: async (role, actor) => {
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
            subtype: "roleCreate",
            ...actorFields(actor),
            targetId: role.id || null,
            target: roleLabel(role),
            reason: `Nuke roleCreate ${result.count}/${result.threshold}`,
            rule: "SECURITY_NUKE_ROLE_CREATE",
            rules: ["SECURITY_NUKE"],
          },
        });
      }
      return { handled: true, nuke: result };
    },

    handleRoleDelete: async (role, actor) => {
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
            subtype: "roleDelete",
            ...actorFields(actor),
            targetId: role.id || null,
            target: roleLabel(role),
            reason: `Nuke roleDelete ${result.count}/${result.threshold}`,
            rule: "SECURITY_NUKE_ROLE_DELETE",
            rules: ["SECURITY_NUKE"],
          },
        });
      }
      return { handled: true, nuke: result };
    },

    // P2-B — CHANNELUPDATE : rafale d'overwrites de salon. ALERT-ONLY.
    // Seules les modifications portant la clé `permissions` alimentent le
    // compteur dédié (5 salons DISTINCTS / 15 s) ; nom, topic, slowmode,
    // position, catégorie… ne comptent pas. Aucune sanction : une alerte
    // `security_perms` unique par fenêtre, via SecurityAlertSuppression.
    handleChannelPermsUpdate: async (channel, changes, actor) => {
      const guild = channel && channel.guild;
      if (!guild) return { handled: false, code: "GUILD_MISSING" };
      const config = await configService.read(guild.id);
      if (!config || !config.security_enabled || !config.security_anti_nuke) return { handled: false, code: "SECURITY_DISABLED" };
      if (!Array.isArray(changes) || !changes.some((change) => change && change.key === "permissions")) {
        return { handled: true, channelBurst: null };
      }

      const burst = perms.recordChannelPermissions({ guildId: guild.id, channelId: channel.id });
      if (burst.triggered) {
        await emitAlert({
          guild,
          action: "security_perms:channelBurst",
          windowMs: burst.windowMs,
          payload: {
            action: "security_perms",
            // Fail-closed : acteur inconnu → null, jamais d'identité inventée.
            moderator: actor ? actor.executor : null,
            moderatorId: actor ? actor.executorId : null,
            targetId: channel.id || null,
            target: channelLabel(channel),
            reason: `Permission overwrites burst ${burst.distinct}/${burst.threshold} in ${burst.windowMs}ms`,
            rule: "SECURITY_PERMS_CHANNEL_BURST",
            rules: ["SECURITY_PERMS"],
          },
        });
      }
      return { handled: true, channelBurst: burst };
    },

    // P2-B — ROLEUPDATE : deux signaux, tous deux alert-only.
    //  1. SIGNAL FORT (N1) — GAIN d'une permission sensible (liste dédiée) ;
    //     une perte n'est jamais un signal, et un simple changement de couleur/
    //     nom/hoist n'atteint jamais ce chemin (pas d'entrée `permissions`).
    //     Dédup par cible : même rôle en boucle → une seule alerte par fenêtre.
    //  2. RAFLE — 3 rôles DISTINCTS dont les permissions ont bougé / 15 s.
    handleRolePermsUpdate: async (role, changes, actor) => {
      const guild = role && role.guild;
      if (!guild) return { handled: false, code: "GUILD_MISSING" };
      const config = await configService.read(guild.id);
      if (!config || !config.security_enabled || !config.security_anti_nuke) return { handled: false, code: "SECURITY_DISABLED" };
      if (!Array.isArray(changes) || !changes.some((change) => change && change.key === "permissions")) {
        return { handled: true, gained: [], roleBurst: null };
      }

      const gained = gainedSensitivePermissions(changes);
      if (gained.length > 0) {
        await emitAlert({
          guild,
          action: `security_perms:roleEscalation:${role.id}`,
          windowMs: SecurityPermsDefaults.ESCALATION_COOLDOWN_MS,
          payload: {
            action: "security_perms",
            moderator: actor ? actor.executor : null,
            moderatorId: actor ? actor.executorId : null,
            targetId: role.id || null,
            target: roleLabel(role),
            reason: `Permissions gained: ${gained.join(", ")}`,
            rule: "SECURITY_PERMS_ROLE_ESCALATION",
            rules: ["SECURITY_PERMS"],
          },
        });
      }

      const burst = perms.recordRolePermissions({ guildId: guild.id, roleId: role.id });
      if (burst.triggered) {
        await emitAlert({
          guild,
          action: "security_perms:roleBurst",
          windowMs: burst.windowMs,
          payload: {
            action: "security_perms",
            moderator: actor ? actor.executor : null,
            moderatorId: actor ? actor.executorId : null,
            targetId: role.id || null,
            target: roleLabel(role),
            reason: `Role permissions burst ${burst.distinct}/${burst.threshold} in ${burst.windowMs}ms`,
            rule: "SECURITY_PERMS_ROLE_BURST",
            rules: ["SECURITY_PERMS"],
          },
        });
      }
      return { handled: true, gained, roleBurst: burst };
    },

    // Expose services for testing
    _raid: raid,
    _bot: bot,
    _nuke: nuke,
    _perms: perms,
    _suppression: suppression,
  });
}

module.exports = { createSecurityRuntime };
