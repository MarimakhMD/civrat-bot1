"use strict";

const { SECURITY_DEFAULTS } = require("../configuration/securityConstants");

/**
 * Reads and writes Security guild configuration through the module-facing
 * GuildConfigResolver contract. Missing keys are merged with safe defaults so
 * the detection services always receive a complete contract.
 */
class SecurityConfigService {
  constructor({ guildConfigResolver }) {
    if (!guildConfigResolver || typeof guildConfigResolver.get !== "function") {
      throw new TypeError("SecurityConfigService requires a guildConfigResolver.");
    }
    this.config = guildConfigResolver;
  }

  async read(guildId) {
    const stored = (await this.config.get(guildId)) || {};
    return { ...SECURITY_DEFAULTS, ...stored };
  }

  async update(guildId, updates) {
    return this.config.update(guildId, updates);
  }
}

module.exports = { SecurityConfigService, SECURITY_DEFAULTS };
