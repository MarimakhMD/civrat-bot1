"use strict";

/**
 * Persistence boundary for guild configuration. Implementations may use any
 * backend, but modules and resolvers only depend on this contract.
 */
class GuildConfigRepository {
  async getByGuildId(_guildId) {
    throw new Error("GuildConfigRepository.getByGuildId must be implemented.");
  }

  async updateByGuildId(_guildId, _updates) {
    throw new Error("GuildConfigRepository.updateByGuildId must be implemented.");
  }

  async invalidate(_guildId) {
    // Optional capability. Repositories without a cache may keep this as a no-op.
  }
}

module.exports = { GuildConfigRepository };
