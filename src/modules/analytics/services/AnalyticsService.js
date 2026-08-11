"use strict";

class AnalyticsService {
  constructor({ configService, analyticsRepository, xpRepository, inviteRepository } = {}) {
    if (!configService || typeof configService.read !== "function") {
      throw new TypeError("AnalyticsService requires a configService");
    }
    this.configService = configService;
    this.analyticsRepository = analyticsRepository;
    this.xpRepository = xpRepository;
    this.inviteRepository = inviteRepository;
  }

  async trackMessage({ guildId, userId }) {
    const config = await this.configService.read(guildId);
    if (!config.analytics_enabled) return { tracked: false, code: "ANALYTICS_DISABLED" };
    if (!this.analyticsRepository) return { tracked: false, code: "NO_REPOSITORY" };
    await this.analyticsRepository.track(guildId, { type: "message", userId });
    return { tracked: true, code: "ANALYTICS_TRACKED" };
  }

  async trackMember({ guildId, userId }) {
    const config = await this.configService.read(guildId);
    if (!config.analytics_enabled) return { tracked: false, code: "ANALYTICS_DISABLED" };
    if (!this.analyticsRepository) return { tracked: false, code: "NO_REPOSITORY" };
    await this.analyticsRepository.track(guildId, { type: "member", userId });
    return { tracked: true, code: "ANALYTICS_TRACKED" };
  }

  async getStats(guildId) {
    const config = await this.configService.read(guildId);
    if (!config.analytics_enabled) return { enabled: false, messages: 0, members: 0, total: 0 };
    if (!this.analyticsRepository) return { enabled: true, messages: 0, members: 0, total: 0 };
    const stats = await this.analyticsRepository.getStats(guildId);
    return { enabled: true, ...stats };
  }

  async getTopXP(guildId, limit = 10) {
    if (!this.xpRepository || typeof this.xpRepository.getLeaderboard !== "function") {
      // Fallback to InMemory XPRepository's internal store if available
      if (this.xpRepository && this.xpRepository.store) {
        const entries = [];
        for (const [key, record] of this.xpRepository.store.entries()) {
          const [g, userId] = key.split(":");
          if (g === guildId) entries.push({ userId, xp: record.xp, level: record.level });
        }
        return entries.sort((a, b) => b.xp - a.xp).slice(0, limit);
      }
      return [];
    }
    // For XP, we need to get leaderboard via repository
    if (typeof this.xpRepository.getLeaderboard === "function") {
      return this.xpRepository.getLeaderboard(guildId, limit);
    }
    // Fallback for InMemoryXPRepository which stores Map
    return [];
  }

  async getTopInvites(guildId, limit = 10) {
    if (!this.inviteRepository || typeof this.inviteRepository.getLeaderboard !== "function") {
      if (this.inviteRepository && this.inviteRepository.invites) {
        const entries = [];
        for (const [key, count] of this.inviteRepository.invites.entries()) {
          const [g, userId] = key.split(":");
          if (g === guildId) entries.push({ userId, current: count });
        }
        return entries.sort((a, b) => b.current - a.current).slice(0, limit);
      }
      return [];
    }
    return this.inviteRepository.getLeaderboard(guildId, limit);
  }
}

module.exports = { AnalyticsService };
