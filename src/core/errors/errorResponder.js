"use strict";

const { CivratError } = require("./CivratError");

/**
 * Converts domain errors into a caller-provided response transport.
 * The responder knows neither Discord.js nor a logging implementation.
 */
class ErrorResponder {
  constructor({ logger = null, fallbackTranslationKey = "errors.internal" } = {}) {
    this.logger = logger;
    this.fallbackTranslationKey = fallbackTranslationKey;
  }

  async respond({ error, context, transport }) {
    const normalized = error instanceof CivratError ? error : null;
    const translationKey = normalized?.isUserSafe ? normalized.translationKey : this.fallbackTranslationKey;
    const message = context.t(translationKey);

    this.#log(error, context, normalized);
    await transport.replyError({ message, ephemeral: true });

    return { code: normalized?.code || "INTERNAL_ERROR", message };
  }

  #log(error, context, normalized) {
    if (!this.logger?.error) return;
    this.logger.error("Core interaction error", {
      code: normalized?.code || "INTERNAL_ERROR",
      metadata: normalized?.metadata || {},
      guildId: context.guildId || null,
      userId: context.userId || null,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

module.exports = { ErrorResponder };
