"use strict";

const { TEMPVOICE_DEFAULTS } = require("../configuration/tempVoiceConstants");

class TempVoiceConfigService {
  constructor({ guildConfigResolver }) {
    if (!guildConfigResolver || typeof guildConfigResolver.get !== "function") {
      throw new TypeError("TempVoiceConfigService requires a guildConfigResolver.");
    }
    this.config = guildConfigResolver;
  }

  async read(guildId) {
    const stored = (await this.config.get(guildId)) || {};
    return { ...TEMPVOICE_DEFAULTS, ...stored };
  }

  async update(guildId, updates) {
    return this.config.update(guildId, updates);
  }
}

module.exports = { TempVoiceConfigService, TEMPVOICE_DEFAULTS };
