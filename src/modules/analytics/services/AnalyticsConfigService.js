"use strict";

const { ANALYTICS_DEFAULTS } = require("../configuration/analyticsConstants");

class AnalyticsConfigService {
  constructor({ guildConfigResolver }) {
    if (!guildConfigResolver || typeof guildConfigResolver.get !== "function") {
      throw new TypeError("AnalyticsConfigService requires a guildConfigResolver.");
    }
    this.config = guildConfigResolver;
  }

  async read(guildId) {
    const stored = (await this.config.get(guildId)) || {};
    return { ...ANALYTICS_DEFAULTS, ...stored };
  }

  async update(guildId, updates) {
    return this.config.update(guildId, updates);
  }
}

module.exports = { AnalyticsConfigService, ANALYTICS_DEFAULTS };
