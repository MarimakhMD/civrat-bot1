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
    // Phase 11 : Mongo seulement si mongoose est RÉELLEMENT connecté. Le
    // modèle UserXP se construit même sans connexion ; sans ce garde-fou,
    // toute lecture/écriture (XP activé, leaderboard Analytics) se bufferisait
    // indéfiniment hors ligne. readyState 1 = connected.
    let repository;
    try {
      const mongoose = require("mongoose");
      if (mongoose.connection?.readyState === 1) {
        const { MongoXPRepository } = require("../persistence/MongoXPRepository");
        repository = new MongoXPRepository();
      } else {
        repository = new InMemoryXPRepository();
      }
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
