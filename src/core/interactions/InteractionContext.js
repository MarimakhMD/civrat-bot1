"use strict";

const { BackendUnavailableError } = require("../errors");

class InteractionContextFactory {
  constructor({ configResolver = null, i18n, permissions, errorResponder }) {
    if (!i18n || !permissions || !errorResponder) {
      throw new TypeError("InteractionContextFactory requires i18n, permissions and errorResponder");
    }
    this.configResolver = configResolver;
    this.i18n = i18n;
    this.permissions = permissions;
    this.errorResponder = errorResponder;
  }

  async create(envelope) {
    const guildId = envelope.guildId || null;
    const configuration = await this.resolveConfiguration(guildId);
    return this.buildContext(envelope, configuration);
  }

  createErrorContext(envelope, error = null) {
    return this.buildContext(envelope, {
      config: {},
      available: false,
      found: false,
      source: "error-context",
      reason: typeof error?.code === "string" ? error.code : null,
    });
  }

  async resolveConfiguration(guildId) {
    if (!guildId || !this.configResolver) {
      return {
        config: {},
        available: true,
        found: false,
        source: guildId ? "not-configured" : "not-applicable",
        reason: null,
      };
    }

    if (typeof this.configResolver.getState === "function") {
      const state = await this.configResolver.getState(guildId);
      if (!state.available && !state.found) {
        throw new BackendUnavailableError({
          operation: "read",
          resource: "guild_config",
          source: state.source,
          reason: state.reason,
        });
      }
      return state;
    }

    const config = await this.configResolver.get(guildId);
    const normalized = config && typeof config === "object" && !Array.isArray(config) ? config : {};
    return {
      config: normalized,
      available: true,
      found: Object.keys(normalized).length > 0,
      source: "resolver",
      reason: null,
    };
  }

  buildContext(envelope, configuration) {
    const guildId = envelope.guildId || null;
    const channelId = envelope.channelId || null;
    const userId = envelope.userId || null;
    const storedLocale = configuration.config?.language;
    const discordLocale = typeof envelope.locale === "string"
      ? envelope.locale.toLowerCase().split(/[-_]/)[0]
      : null;
    const locale = [storedLocale, discordLocale].find((value) => value === "en" || value === "fr") || "fr";
    const frozenConfiguration = Object.freeze({
      config: configuration.config || {},
      available: Boolean(configuration.available),
      found: Boolean(configuration.found),
      source: configuration.source || "unknown",
      reason: configuration.reason || null,
    });
    const translation = this.i18n.forLocale(locale);

    return Object.freeze({
      envelope,
      guildId,
      channelId,
      userId,
      member: envelope.member || null,
      config: frozenConfiguration.config,
      configuration: frozenConfiguration,
      t: translation,
      permissions: this.permissions,
      respondError: (error) => this.errorResponder.respond({
        error,
        context: { guildId, channelId, userId, t: translation },
        transport: envelope.transport,
      }),
    });
  }
}

module.exports = { InteractionContextFactory };
