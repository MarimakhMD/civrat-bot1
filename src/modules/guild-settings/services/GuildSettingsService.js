"use strict";

const { ValidationError } = require("../../../core/errors");
const { isSupportedLocale } = require("../../../core/i18n");
const { EntitlementDecision } = require("../../../core/entitlements");
const { SETTINGS_CATALOG } = require("../configuration/settingsCatalog");

const PREMIUM_FEATURES = Object.freeze([
  ...new Set(SETTINGS_CATALOG.flatMap((category) => (
    category.features.flatMap((feature) => feature.premiumFeatures)
  ))),
]);

class GuildSettingsService {
  constructor({
    guildConfigResolver,
    configurationReader = null,
    entitlementService = null,
    logger = null,
  } = {}) {
    if (!guildConfigResolver) throw new Error("GuildSettingsService requires guildConfigResolver");
    this.guildConfigResolver = guildConfigResolver;
    this.configurationReader = configurationReader;
    this.entitlementService = entitlementService;
    this.logger = logger;
  }

  async getLanguage(guildId) {
    return this.guildConfigResolver.getLanguage(guildId);
  }

  async updateLanguage(guildId, language) {
    if (!isSupportedLocale(language)) {
      throw new ValidationError({ field: "language", reason: "unsupported_locale" });
    }
    const config = await this.guildConfigResolver.update(guildId, { language });
    this.logger?.info?.("Guild language updated", { guildId, language });
    return config;
  }

  async getConfigurationState(guildId) {
    if (typeof this.configurationReader === "function") {
      return this.configurationReader(guildId);
    }
    return {
      config: await this.guildConfigResolver.get(guildId),
      available: false,
      found: false,
      source: "legacy",
    };
  }

  async getPremiumDecisions(guildId) {
    const entries = await Promise.all(PREMIUM_FEATURES.map(async (feature) => {
      if (!this.entitlementService || !guildId) {
        return [feature, { ok: false, granted: false, code: EntitlementDecision.UNAVAILABLE }];
      }
      return [feature, await this.entitlementService.requireFeature({ guildId, feature })];
    }));
    return Object.fromEntries(entries);
  }
}

module.exports = { GuildSettingsService, PREMIUM_FEATURES };
