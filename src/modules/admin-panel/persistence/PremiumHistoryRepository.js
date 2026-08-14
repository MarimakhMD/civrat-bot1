"use strict";

/**
 * Historique Premium (activations / désactivations / révocations) — append-only.
 * Ne contient JAMAIS de secret : uniquement des ids, statuts, dates et un
 * libellé d'action.
 */
class PremiumHistoryRepository {
  async append(_entry) {
    throw new Error("PremiumHistoryRepository.append must be implemented.");
  }

  async listByGuild(_guildId, _options) {
    throw new Error("PremiumHistoryRepository.listByGuild must be implemented.");
  }

  async listRecent(_options) {
    throw new Error("PremiumHistoryRepository.listRecent must be implemented.");
  }
}

module.exports = { PremiumHistoryRepository };
