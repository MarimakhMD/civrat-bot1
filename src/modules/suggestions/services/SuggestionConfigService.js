"use strict";

const { SUGGESTION_DEFAULTS } = require("../configuration/suggestionConstants");

class SuggestionConfigService {
  constructor({ guildConfigResolver }) {
    if (!guildConfigResolver || typeof guildConfigResolver.get !== "function") {
      throw new TypeError("SuggestionConfigService requires a guildConfigResolver.");
    }
    this.config = guildConfigResolver;
  }

  async read(guildId) {
    const stored = (await this.config.get(guildId)) || {};
    return { ...SUGGESTION_DEFAULTS, ...stored };
  }

  async update(guildId, updates) {
    return this.config.update(guildId, updates);
  }
}

module.exports = { SuggestionConfigService, SUGGESTION_DEFAULTS };
