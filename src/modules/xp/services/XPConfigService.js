"use strict";

const { XP_DEFAULTS } = require("../configuration/xpConstants");

class XPConfigService {
  constructor({ guildConfigResolver }) {
    if (!guildConfigResolver || typeof guildConfigResolver.get !== "function") {
      throw new TypeError("XPConfigService requires a guildConfigResolver.");
    }
    this.config = guildConfigResolver;
  }

  async read(guildId) {
    const stored = (await this.config.get(guildId)) || {};
    return { ...XP_DEFAULTS, ...stored };
  }

  async update(guildId, updates) {
    return this.config.update(guildId, updates);
  }
}

module.exports = { XPConfigService, XP_DEFAULTS };
