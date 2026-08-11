"use strict";

const { AnalyticsService } = require("../services/AnalyticsService");
const { InMemoryAnalyticsRepository } = require("../persistence/InMemoryAnalyticsRepository");

function createAnalyticsRuntime({ configService, analyticsRepository, xpRepository, inviteRepository } = {}) {
  if (!configService || typeof configService.read !== "function") {
    throw new TypeError("createAnalyticsRuntime requires configService");
  }
  const repo = analyticsRepository || new InMemoryAnalyticsRepository();
  const service = new AnalyticsService({ configService, analyticsRepository: repo, xpRepository, inviteRepository });

  return Object.freeze({
    trackMessage: async (message) => {
      if (!message || !message.guild || !message.author) return { tracked: false, code: "IGNORED" };
      try {
        return await service.trackMessage({ guildId: message.guild.id, userId: message.author.id });
      } catch {
        return { tracked: false, code: "TRACK_FAILED" };
      }
    },
    trackMember: async (member) => {
      if (!member || !member.guild) return { tracked: false, code: "IGNORED" };
      try {
        return await service.trackMember({ guildId: member.guild.id, userId: member.id });
      } catch {
        return { tracked: false, code: "TRACK_FAILED" };
      }
    },
    getStats: async (guildId) => service.getStats(guildId),
    getTopXP: async (guildId, limit) => service.getTopXP(guildId, limit),
    getTopInvites: async (guildId, limit) => service.getTopInvites(guildId, limit),
    _service: service,
    _repository: repo,
  });
}

module.exports = { createAnalyticsRuntime };
