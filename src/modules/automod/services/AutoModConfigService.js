"use strict";

const DEFAULTS = Object.freeze({
  automod_enabled: false,
  automod_anti_spam: false,
  automod_anti_links: false,
  automod_anti_invites: false,
  automod_anti_mention_spam: false,
  automod_mention_threshold: 5,
  automod_anti_emoji_spam: false,
  automod_emoji_threshold: 8,
  automod_anti_caps: false,
  automod_caps_threshold: 70,
  automod_bad_words: [],
  automod_delete_message: true,
  automod_punishment: "none",
  automod_timeout_minutes: 10,
});

/**
 * Reads and writes AutoMod guild configuration through the module-facing
 * GuildConfigResolver contract. Missing keys are merged with safe defaults so
 * the detection and enforcement services always receive a complete contract.
 */
class AutoModConfigService {
  constructor({ guildConfigResolver }) {
    if (!guildConfigResolver || typeof guildConfigResolver.get !== "function") {
      throw new TypeError("AutoModConfigService requires a guildConfigResolver.");
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

module.exports = { AutoModConfigService, AUTOMOD_DEFAULTS: DEFAULTS };
