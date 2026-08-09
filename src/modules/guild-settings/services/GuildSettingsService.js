"use strict";
const { ValidationError } = require("../../../core/errors");
const { isSupportedLocale } = require("../../../core/i18n");
class GuildSettingsService {
  constructor({ guildConfigResolver, logger = null }) { this.guildConfigResolver = guildConfigResolver; this.logger = logger; }
  async getLanguage(guildId) { return this.guildConfigResolver.getLanguage(guildId); }
  async updateLanguage(guildId, language) {
    if (!isSupportedLocale(language)) throw new ValidationError({ field: "language", reason: "unsupported_locale" });
    const config = await this.guildConfigResolver.update(guildId, { language });
    this.logger?.info?.("Guild language updated", { guildId, language });
    return config;
  }
}
module.exports = { GuildSettingsService };
