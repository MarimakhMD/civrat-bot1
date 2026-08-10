"use strict";

const legacy = require("../../../services/guildConfig");
const { GuildConfigResolver, LegacyGuildConfigRepository } = require("../../../core/guild-config");
const { AutoModConfigService } = require("../services/AutoModConfigService");
const { createAutoModRuntime } = require("./createAutoModRuntime");

let runtime;

function getAutoModRuntime() {
  if (!runtime) {
    const repository = new LegacyGuildConfigRepository({
      getConfig: legacy.getGuildConfig,
      updateConfig: legacy.updateGuildConfig,
      invalidateConfig: legacy.invalidateCache,
    });
    const configService = new AutoModConfigService({ guildConfigResolver: new GuildConfigResolver({ repository }) });
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

module.exports = { getAutoModRuntime };
