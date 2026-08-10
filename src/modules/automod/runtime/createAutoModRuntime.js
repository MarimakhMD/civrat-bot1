"use strict";

const { AutoModDetectionService } = require("../services/AutoModDetectionService");
const { AutoModEnforcementService } = require("../services/AutoModEnforcementService");
const { DiscordAutoModTransport } = require("../../../adapters/discord/DiscordAutoModTransport");

function countMentions(message) {
  if (!message || !message.mentions) return 0;
  if (typeof message.mentions.size === "number") return message.mentions.size;
  return message.mentions.users ? message.mentions.users.size : message.mentions.members ? message.mentions.members.size : 0;
}

function safeHas(permissions, name) {
  try {
    return Boolean(permissions.has(name));
  } catch {
    return false;
  }
}

/**
 * Builds the AutoMod runtime. The runtime reads guild configuration, runs the
 * transport-neutral detection service, and applies the configured enforcement
 * through an injected enforcer factory.
 */
function createAutoModRuntime({ guildConfigResolver, configService, detection, enforcementService, enforcerFactory, logsRuntimeFactory }) {
  const resolver = configService || (guildConfigResolver ? { read: (guildId) => guildConfigResolver.get(guildId) } : null);
  if (!resolver || typeof resolver.read !== "function") {
    throw new TypeError("createAutoModRuntime requires guildConfigResolver or configService.");
  }

  const detector = detection || new AutoModDetectionService();
  const enforcer = enforcementService || new AutoModEnforcementService();
  const makeEnforcer = enforcerFactory || ((message) => new DiscordAutoModTransport({ guild: message.guild }));
  const logFactory = typeof logsRuntimeFactory === "function" ? logsRuntimeFactory : () => null;

  return {
    handleMessage: async (message) => {
      if (!message || !message.guild) return { matched: false, code: "AUTOMOD_IGNORED" };

      const config = await resolver.read(message.guild.id);
      if (!config || !config.automod_enabled) return { matched: false, code: "AUTOMOD_DISABLED" };
      if (message.author && message.author.bot) return { matched: false, code: "AUTOMOD_IGNORED" };

      const member = message.member;
      const authorPermissions = member && member.permissions
        ? { administrator: safeHas(member.permissions, "Administrator"), manageMessages: safeHas(member.permissions, "ManageMessages") }
        : null;

      const result = detector.detect({
        config,
        authorIsBot: Boolean(message.author && message.author.bot),
        authorPermissions,
        guildId: message.guild.id,
        authorId: message.author && message.author.id,
        content: message.content || "",
        mentionCount: countMentions(message),
      });

      if (!result.matched) return { matched: false, code: "AUTOMOD_NO_MATCH" };

      const actions = await enforcer.enforce({
        message,
        detection: result,
        config,
        enforcer: makeEnforcer(message),
        logsRuntimeFactory: logFactory,
      });

      return { matched: true, code: result.code, rules: result.rules, actions };
    },
  };
}

module.exports = { createAutoModRuntime, countMentions };
