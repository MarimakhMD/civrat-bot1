"use strict";

const { GuildConfigResolver, LegacyGuildConfigRepository } = require("../../../core/guild-config");
const { AnalyticsConfigService } = require("../services/AnalyticsConfigService");
const { createAnalyticsRuntime } = require("./createAnalyticsRuntime");
const { InMemoryAnalyticsRepository } = require("../persistence/InMemoryAnalyticsRepository");

let runtime;

function getAnalyticsRuntime() {
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
    const configService = new AnalyticsConfigService({ guildConfigResolver });
    // Reuse existing XP and Invites repositories if available, otherwise InMemory
    let xpRepository = null;
    let inviteRepository = null;
    try {
      const { InMemoryXPRepository } = require("../../xp/persistence/XPRepository");
      xpRepository = new InMemoryXPRepository();
    } catch {}
    try {
      const { InMemoryInviteStatsRepository } = require("../../invites/persistence/InviteStatsRepository");
      inviteRepository = new InMemoryInviteStatsRepository();
    } catch {}
    runtime = createAnalyticsRuntime({ configService, xpRepository, inviteRepository });
  }
  return runtime;
}

function _resetForTests() {
  runtime = null;
}

module.exports = { getAnalyticsRuntime, _resetForTests };
