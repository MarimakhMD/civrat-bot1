"use strict";

const { GuildConfigResolver, LegacyGuildConfigRepository } = require("../../../core/guild-config");
const { AutoModConfigService } = require("../services/AutoModConfigService");
const { createAutoModRuntime } = require("./createAutoModRuntime");

let runtime;

function getAutoModRuntime() {
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
      // Fallback: in-memory resolver with defaults (offline/tests, missing legacy file on main)
      guildConfigResolver = {
        get: async () => ({}),
        update: async () => ({}),
      };
    }
    const configService = new AutoModConfigService({ guildConfigResolver });
    runtime = createAutoModRuntime({
      configService,
      logsRuntimeFactory: () => {
        try {
          return require("../../logs/runtime/getLogsRuntime").getLogsRuntime();
        } catch {
          return null;
        }
      },
    });
  }
  return runtime;
}

function _resetForTests() {
  runtime = null;
}

module.exports = { getAutoModRuntime, _resetForTests };
