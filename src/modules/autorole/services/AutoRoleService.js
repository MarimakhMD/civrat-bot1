"use strict";

const DEFAULTS = Object.freeze({
  autorole_enabled: false,
  autorole_member_role_id: null,
  autorole_bot_role_id: null,
});

/**
 * Reads and writes AutoRole guild configuration through the module-facing
 * GuildConfigResolver contract. Missing keys are merged with safe defaults so
 * the eligibility and integration services always receive a complete contract
 * and never throw on a guild that has never configured AutoRole.
 */
class AutoRoleService {
  constructor({ guildConfigResolver }) {
    if (!guildConfigResolver || typeof guildConfigResolver.get !== "function") {
      throw new TypeError("AutoRoleService requires a guildConfigResolver.");
    }
    this.config = guildConfigResolver;
  }

  async read(guildId) {
    const stored = (await this.config.get(guildId)) || {};
    return { ...DEFAULTS, ...stored };
  }

  async update(guildId, updates) {
    return this.config.update(guildId, updates);
  }
}

module.exports = { AutoRoleService, AUTOROLE_DEFAULTS: DEFAULTS };
