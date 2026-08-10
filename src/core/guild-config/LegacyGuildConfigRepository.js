"use strict";

const { GuildConfigRepository } = require("./GuildConfigRepository");

/**
 * Transitional adapter around the existing configuration service. Dependencies
 * are injected so the core does not import legacy code or persistence clients.
 */
class LegacyGuildConfigRepository extends GuildConfigRepository {
  constructor({ getConfig, updateConfig, invalidateConfig = async () => {} }) {
    super();
    if (typeof getConfig !== "function" || typeof updateConfig !== "function" || typeof invalidateConfig !== "function") {
      throw new TypeError("LegacyGuildConfigRepository requires getConfig, updateConfig, and invalidateConfig functions.");
    }
    this.getConfig = getConfig;
    this.updateConfig = updateConfig;
    this.invalidateConfig = invalidateConfig;
  }

  async getByGuildId(guildId) { return this.getConfig(guildId); }
  async updateByGuildId(guildId, updates) { return this.updateConfig(guildId, updates); }
  async invalidate(guildId) { return this.invalidateConfig(guildId); }
}

module.exports = { LegacyGuildConfigRepository };
