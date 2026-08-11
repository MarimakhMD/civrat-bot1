"use strict";

const { GuildConfigResolver, LegacyGuildConfigRepository } = require("../../../core/guild-config");
const { TempVoiceConfigService } = require("../services/TempVoiceConfigService");
const { createTempVoiceRuntime } = require("./createTempVoiceRuntime");

let runtime;

function getTempVoiceRuntime() {
  if (!runtime) {
    let guildConfigResolver;
    try {
      const legacy = require("../../../services/guildConfig");
      const repository = new LegacyGuildConfigRepository({
        getConfig: legacy.getGuildConfig,
        updateConfig: legacy.updateGuildConfig,
        invalidateConfig: legacy.invalidateCache,
      });
      guildConfigResolver = new GuildConfigResolver({ repository });
    } catch {
      guildConfigResolver = { get: async () => ({}), update: async () => ({}) };
    }
    const configService = new TempVoiceConfigService({ guildConfigResolver });
    runtime = createTempVoiceRuntime({ configService });
  }
  return runtime;
}

function _resetForTests() {
  runtime = null;
}

module.exports = { getTempVoiceRuntime, _resetForTests };
