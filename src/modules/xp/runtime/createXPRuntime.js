"use strict";

const { XPService } = require("../services/XPService");
const { LevelService } = require("../services/LevelService");
const { InMemoryXPRepository } = require("../persistence/XPRepository");

function createXPRuntime({ configService, repository, levelService, xpService, logsRuntimeFactory, clock, random } = {}) {
  if (!configService || typeof configService.read !== "function") {
    throw new TypeError("createXPRuntime requires configService");
  }
  const repo = repository || new InMemoryXPRepository();
  const levels = levelService || new LevelService();
  const service = xpService || new XPService({ repository: repo, levelService: levels, clock, random });
  const makeLogs = typeof logsRuntimeFactory === "function" ? logsRuntimeFactory : () => null;

  return Object.freeze({
    handleMessage: async (message) => {
      if (!message || !message.guild || !message.author) return { handled: false, code: "XP_IGNORED" };
      const guildId = message.guild.id;
      const userId = message.author.id;
      const isBot = Boolean(message.author.bot);
      const config = await configService.read(guildId);
      if (!config || !config.xp_enabled) return { handled: false, code: "XP_DISABLED" };
      // Channel filter: if xp_channel_id set, only that channel gives XP
      if (config.xp_channel_id && message.channel && message.channel.id !== config.xp_channel_id) {
        return { handled: false, code: "XP_WRONG_CHANNEL" };
      }
      const result = await service.handleMessage({ guildId, userId, isBot, config });
      if (result.leveledUp) {
        const logs = makeLogs();
        if (logs && !logs.disabled) {
          try {
            await logs.handleModerationEvent({
              guild: message.guild,
              action: "xp_level_up",
              targetId: userId,
              reason: `Leveled up to ${result.level}`,
              rule: "XP_LEVEL_UP",
              rules: ["XP_LEVEL_UP"],
            });
          } catch {}
        }
      }
      return result;
    },
    _service: service,
    _repository: repo,
  });
}

module.exports = { createXPRuntime };
