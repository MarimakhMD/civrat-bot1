"use strict";

const { GuildConfigResolver, LegacyGuildConfigRepository } = require("../../../core/guild-config");
const { XPConfigService } = require("../services/XPConfigService");
const { createXPRuntime } = require("./createXPRuntime");
const { InMemoryXPRepository } = require("../persistence/XPRepository");

let runtime;

function getXPRuntime() {
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
      guildConfigResolver = {
        get: async () => ({}),
        update: async () => ({}),
      };
    }
    const configService = new XPConfigService({ guildConfigResolver });
    // Try Mongo, fallback to in-memory
    let repository;
    try {
      const { MongoXPRepository } = require("../persistence/MongoXPRepository");
      repository = new MongoXPRepository();
    } catch {
      repository = new InMemoryXPRepository();
    }
    runtime = createXPRuntime({
      configService,
      repository,
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

module.exports = { getXPRuntime, _resetForTests };
