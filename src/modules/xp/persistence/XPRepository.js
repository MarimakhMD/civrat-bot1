"use strict";

class XPRepository {
  async findOne(guildId, userId) {
    throw new Error("XPRepository.findOne must be implemented");
  }

  async upsert(guildId, userId, xp, level) {
    throw new Error("XPRepository.upsert must be implemented");
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

  clear() {
    this.store.clear();
  }
}

module.exports = { XPRepository, InMemoryXPRepository };
