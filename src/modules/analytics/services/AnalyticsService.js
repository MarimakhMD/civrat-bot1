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

  // Phase 11 : les classements passent par le contrat getLeaderboard des
  // repositories (implémenté par les implémentations InMemory ET Mongo), et
  // lisent la MÊME instance que le chemin d'écriture (runtime unifié) — plus
  // aucune lecture d'un store interne disjoint. Défensif : sans repository ou
  // sans contrat, liste vide (comportement « non configuré » préservé).
  async getTopXP(guildId, limit = 10) {
    if (!this.xpRepository || typeof this.xpRepository.getLeaderboard !== "function") return [];
    return this.xpRepository.getLeaderboard(guildId, limit);
  }

  async getTopInvites(guildId, limit = 10) {
    if (!this.inviteRepository || typeof this.inviteRepository.getLeaderboard !== "function") return [];
    return this.inviteRepository.getLeaderboard(guildId, limit);
  }
}

module.exports = { AnalyticsService };
