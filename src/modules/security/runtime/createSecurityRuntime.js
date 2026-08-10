"use strict";

const { SecurityRaidService } = require("../services/SecurityRaidService");
const { SecurityBotService } = require("../services/SecurityBotService");
const { SecurityNukeService } = require("../services/SecurityNukeService");
const { DiscordSecurityTransport } = require("../../../adapters/discord/DiscordSecurityTransport");

/**
 * Creates Security runtime wiring raid/bot/nuke detection with transport and logs.
 * All services are transport-neutral; Discord and Logs are injected.
 */
function createSecurityRuntime({
  configService,
  raidService,
  botService,
  nukeService,
  transportFactory,
  logsRuntimeFactory,
} = {}) {
  if (!configService || typeof configService.read !== "function") {
    throw new TypeError("createSecurityRuntime requires configService.");
  }
  const raid = raidService || new SecurityRaidService();
  const bot = botService || new SecurityBotService();
  const nuke = nukeService || new SecurityNukeService();
  const makeTransport = typeof transportFactory === "function" ? transportFactory : (guild) => new DiscordSecurityTransport({ guild });
  const makeLogs = typeof logsRuntimeFactory === "function" ? logsRuntimeFactory : () => null;

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
          const logs = makeLogs();
          if (logs && !logs.disabled) {
            try {
              await logs.handleModerationEvent({
                guild,
                action: "security_raid",
                targetId: member.id,
                reason: `Raid: ${raidResult.count}/${raidResult.threshold} in ${raidResult.windowMs}ms`,
                rule: "SECURITY_RAID",
                rules: ["SECURITY_RAID"],
              });
              results.logged.push("security_raid");
            } catch {}
          }
        }
      }

      // Anti-bot / whitelist
      if (member.user && config.security_anti_bot) {
        const botResult = bot.check({ isBot: Boolean(member.user.bot), userId: member.id, config });
        results.bot = botResult;
        if (!botResult.allowed) {
          const logs = makeLogs();
          if (logs && !logs.disabled) {
            try {
              await logs.handleModerationEvent({
                guild,
                action: "security_bot",
                targetId: member.id,
                reason: `Bot not whitelisted: ${member.id}`,
                rule: "SECURITY_BOT",
                rules: ["SECURITY_BOT"],
              });
              results.logged.push("security_bot");
            } catch {}
          }
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
        const logs = makeLogs();
        if (logs && !logs.disabled) {
          try {
            await logs.handleModerationEvent({
              guild,
              action: "security_nuke",
              targetId: null,
              reason: `Nuke channelCreate ${result.count}/${result.threshold}`,
              rule: "SECURITY_NUKE_CHANNEL_CREATE",
              rules: ["SECURITY_NUKE"],
            });
          } catch {}
        }
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
        const logs = makeLogs();
        if (logs && !logs.disabled) {
          try {
            await logs.handleModerationEvent({
              guild,
              action: "security_nuke",
              targetId: null,
              reason: `Nuke channelDelete ${result.count}/${result.threshold}`,
              rule: "SECURITY_NUKE_CHANNEL_DELETE",
              rules: ["SECURITY_NUKE"],
            });
          } catch {}
        }
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
        const logs = makeLogs();
        if (logs && !logs.disabled) {
          try {
            await logs.handleModerationEvent({
              guild,
              action: "security_nuke",
              targetId: null,
              reason: `Nuke roleCreate ${result.count}/${result.threshold}`,
              rule: "SECURITY_NUKE_ROLE_CREATE",
              rules: ["SECURITY_NUKE"],
            });
          } catch {}
        }
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
        const logs = makeLogs();
        if (logs && !logs.disabled) {
          try {
            await logs.handleModerationEvent({
              guild,
              action: "security_nuke",
              targetId: null,
              reason: `Nuke roleDelete ${result.count}/${result.threshold}`,
              rule: "SECURITY_NUKE_ROLE_DELETE",
              rules: ["SECURITY_NUKE"],
            });
          } catch {}
        }
      }
      return { handled: true, nuke: result };
    },

    // Expose services for testing
    _raid: raid,
    _bot: bot,
    _nuke: nuke,
  });
}

module.exports = { createSecurityRuntime };
