"use strict";

const { GIVEAWAY_DEFAULTS } = require("../configuration/giveawayConstants");

class GiveawayConfigService {
  constructor({ guildConfigResolver }) {
    if (!guildConfigResolver || typeof guildConfigResolver.get !== "function") {
      throw new TypeError("GiveawayConfigService requires a guildConfigResolver.");
    }
    this.config = guildConfigResolver;
  }

  async read(guildId) {
    const stored = (await this.config.get(guildId)) || {};
    return { ...GIVEAWAY_DEFAULTS, ...stored };
  }

  async update(guildId, updates) {
    return this.config.update(guildId, updates);
  }
}

module.exports = { GiveawayConfigService, GIVEAWAY_DEFAULTS };
