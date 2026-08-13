"use strict";

class XPRepository {
  async findOne(guildId, userId) {
    throw new Error("XPRepository.findOne must be implemented");
  }

  async upsert(guildId, userId, xp, level) {
    throw new Error("XPRepository.upsert must be implemented");
  }

  // Phase 11 : contrat du classement XP consommé par Analytics (/analytics,
  // /analytics_xp). Retourne [{ userId, xp, level }] trié du plus haut XP au
  // plus bas, limité à `limit` entrées, isolé par guilde.
  async getLeaderboard(_guildId, _limit = 10) {
    throw new Error("XPRepository.getLeaderboard must be implemented");
  }
}

class InMemoryXPRepository extends XPRepository {
  constructor() {
    super();
    this.store = new Map(); // key: guildId:userId -> {guildId, userId, xp, level}
  }

  _key(guildId, userId) {
    return `${guildId}:${userId}`;
  }

  async findOne(guildId, userId) {
    return this.store.get(this._key(guildId, userId)) || null;
  }

  async upsert(guildId, userId, xp, level) {
    const key = this._key(guildId, userId);
    const record = { guildId, userId, xp, level, updatedAt: Date.now() };
    this.store.set(key, record);
    return record;
  }

  async getLeaderboard(guildId, limit = 10) {
    const entries = [];
    for (const record of this.store.values()) {
      if (record.guildId === guildId) entries.push({ userId: record.userId, xp: record.xp, level: record.level });
    }
    return entries.sort((a, b) => b.xp - a.xp || b.level - a.level).slice(0, limit);
  }

  clear() {
    this.store.clear();
  }
}

module.exports = { XPRepository, InMemoryXPRepository };
