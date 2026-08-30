"use strict";

class LegacyGuildConfigRepository {
  constructor({ getConfig, getConfigState = null, updateConfig, invalidate = null, invalidateConfig = null }) {
    if (typeof getConfig !== "function" || typeof updateConfig !== "function") {
      throw new TypeError("LegacyGuildConfigRepository requires getConfig and updateConfig functions");
    }
    this.getConfig = getConfig;
    this.getConfigState = typeof getConfigState === "function"
      ? getConfigState
      : typeof getConfig.getState === "function"
        ? getConfig.getState
        : null;
    this.updateConfig = updateConfig;
    const invalidator = typeof invalidate === "function" ? invalidate : invalidateConfig;
    this.invalidateConfig = typeof invalidator === "function" ? invalidator : async () => {};
  }

  async getByGuildId(guildId) {
    return this.getConfig(guildId);
  }

  async getStateByGuildId(guildId) {
    if (this.getConfigState) return this.getConfigState(guildId);

    const config = await this.getConfig(guildId);
    const normalized = config && typeof config === "object" && !Array.isArray(config) ? config : {};
    return {
      config: normalized,
      available: true,
      found: Object.keys(normalized).length > 0,
      source: "legacy",
      reason: null,
    };
  }

  async updateByGuildId(guildId, patch) {
    return this.updateConfig(guildId, patch);
  }

  async invalidate(guildId) {
    return this.invalidateConfig(guildId);
  }
}

module.exports = { LegacyGuildConfigRepository };
