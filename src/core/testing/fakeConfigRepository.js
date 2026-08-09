"use strict";

/** In-memory repository test double for isolated core tests. */
function createFakeConfigRepository(configByGuildId = {}) {
  const invalidated = [];
  const updates = [];
  return {
    invalidated,
    updates,
    async getByGuildId(guildId) { return configByGuildId[guildId] || null; },
    async updateByGuildId(guildId, patch) {
      const current = configByGuildId[guildId] || {};
      const next = { ...current, ...patch };
      configByGuildId[guildId] = next;
      updates.push({ guildId, patch });
      return next;
    },
    async invalidate(guildId) { invalidated.push(guildId); },
  };
}

module.exports = { createFakeConfigRepository };
