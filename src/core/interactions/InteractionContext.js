"use strict";

const { resolveGuildLocale } = require("../i18n");

/**
 * Builds lazy, transport-neutral contexts for route handlers. The envelope is
 * produced by a future transport adapter and may represent a guild or a DM.
 */
class InteractionContextFactory {
  constructor({ guildConfigResolver = null, i18n, permissions, errorResponder, logger = null }) {
    if (!i18n || !permissions || !errorResponder) {
      throw new TypeError("InteractionContextFactory requires i18n, permissions, and errorResponder.");
    }
    this.guildConfigResolver = guildConfigResolver;
    this.i18n = i18n;
    this.permissions = permissions;
    this.errorResponder = errorResponder;
    this.logger = logger;
  }

  async create(envelope) {
    const guildId = envelope.guildId || null;
    const config = guildId && this.guildConfigResolver ? await this.guildConfigResolver.get(guildId) : null;
    const locale = resolveGuildLocale(config?.language || envelope.locale);

    return Object.freeze({
      envelope,
      guildId,
      channelId: envelope.channelId || null,
      userId: envelope.userId || null,
      member: envelope.member || null,
      config,
      locale,
      t: this.i18n.forLocale(locale),
      permissions: this.permissions,
      respondError: (error) => this.errorResponder.respond({ error, context: { guildId, userId: envelope.userId || null, t: this.i18n.forLocale(locale) }, transport: envelope.transport }),
      logger: this.logger,
    });
  }
}

module.exports = { InteractionContextFactory };
