"use strict";

const { CivratError } = require("./CivratError");
const { ErrorCode } = require("./errorCodes");

const FALLBACK_MESSAGES = Object.freeze({
  [ErrorCode.INTERNAL_ERROR]: "An unexpected error occurred.",
  [ErrorCode.VALIDATION_FAILED]: "Some information is invalid.",
  [ErrorCode.AUTHORIZATION_DENIED]: "You are not allowed to perform this action.",
  [ErrorCode.RESOURCE_NOT_FOUND]: "The requested resource could not be found.",
  [ErrorCode.ROUTE_NOT_FOUND]: "This action is no longer available.",
  [ErrorCode.CONFIGURATION_UNAVAILABLE]: "The server configuration is temporarily unavailable.",
  [ErrorCode.CONFIGURATION_INVALID]: "The server configuration is invalid.",
  [ErrorCode.INTERACTION_UNSUPPORTED]: "This interaction is not supported.",
  [ErrorCode.BACKEND_UNAVAILABLE]: "The service is temporarily unavailable. No change was saved.",
  [ErrorCode.PERSISTENCE_FAILED]: "The change could not be saved. No success was recorded.",
  [ErrorCode.PERSISTENCE_CONFLICT]: "The change conflicts with a more recent value. Please retry.",
  [ErrorCode.PERSISTENCE_SCHEMA_MISMATCH]: "This setting is not available on the configured backend.",
  [ErrorCode.PERSISTENCE_PERMISSION_DENIED]: "The backend refused this change. No change was saved.",
  [ErrorCode.PREMIUM_REQUIRED]: "This feature requires CIVRAT Premium.",
  [ErrorCode.ENTITLEMENT_UNAVAILABLE]: "Premium access cannot be verified right now.",
  [ErrorCode.INTERACTION_EXPIRED]: "This interaction has expired. Please run the action again.",
  [ErrorCode.INTERACTION_ALREADY_ACKNOWLEDGED]: "This interaction was already handled.",
  [ErrorCode.DISCORD_PERMISSION_DENIED]: "Discord refused this action because the bot lacks access or permissions.",
  [ErrorCode.DISCORD_RESOURCE_NOT_FOUND]: "The Discord resource used by this action no longer exists.",
  [ErrorCode.DISCORD_UNAVAILABLE]: "Discord is temporarily unavailable. Please retry later.",
});

const SAFE_METADATA_KEYS = new Set([
  "classification",
  "discordCode",
  "httpStatus",
  "operation",
  "resource",
  "source",
  "reason",
]);

const OBSERVABLE_ERROR_CODES = new Set([
  ErrorCode.CONFIGURATION_UNAVAILABLE,
  ErrorCode.CONFIGURATION_INVALID,
  ErrorCode.BACKEND_UNAVAILABLE,
  ErrorCode.PERSISTENCE_FAILED,
  ErrorCode.PERSISTENCE_CONFLICT,
  ErrorCode.PERSISTENCE_SCHEMA_MISMATCH,
  ErrorCode.PERSISTENCE_PERMISSION_DENIED,
  ErrorCode.ENTITLEMENT_UNAVAILABLE,
  ErrorCode.INTERACTION_EXPIRED,
  ErrorCode.INTERACTION_ALREADY_ACKNOWLEDGED,
  ErrorCode.DISCORD_PERMISSION_DENIED,
  ErrorCode.DISCORD_RESOURCE_NOT_FOUND,
  ErrorCode.DISCORD_UNAVAILABLE,
]);

class ErrorResponder {
  constructor({ logger = null } = {}) {
    this.logger = logger;
  }

  async respond({ error, context, transport }) {
    const normalized = this.normalize(error);
    const message = this.translate(normalized, context);
    const response = {
      code: normalized.code,
      message,
      details: normalized.metadata,
    };

    this.log(normalized, error, context);

    if (normalized.terminal) {
      return { ...response, delivered: false, terminal: true };
    }

    if (!transport || typeof transport.replyError !== "function") {
      return { ...response, delivered: false, terminal: false };
    }

    try {
      const delivery = await transport.replyError(response);
      const delivered = !(delivery && typeof delivery === "object" && delivery.delivered === false);
      return { ...response, delivered, terminal: false };
    } catch (deliveryError) {
      this.logDeliveryFailure(deliveryError, normalized, context);
      return { ...response, delivered: false, terminal: false };
    }
  }

  normalize(error) {
    if (error instanceof CivratError) return error;
    return new CivratError({
      code: ErrorCode.INTERNAL_ERROR,
      message: "Unexpected internal error",
      translationKey: "errors.internal",
      cause: error instanceof Error ? error : null,
    });
  }

  translate(error, context) {
    if (typeof context?.t === "function") {
      const translated = context.t(error.translationKey, error.metadata);
      if (translated && translated !== error.translationKey) return translated;
    }
    return FALLBACK_MESSAGES[error.code] || FALLBACK_MESSAGES[ErrorCode.INTERNAL_ERROR];
  }

  log(error, originalError, context) {
    const unexpected = !(originalError instanceof CivratError);
    const observable = OBSERVABLE_ERROR_CODES.has(error.code);
    if (!unexpected && !observable && !error.terminal && !error.retryable && error.reportLevel !== "error") return;

    const level = unexpected || error.reportLevel === "error" ? "error" : "warn";
    const writer = this.logger?.[level] || this.logger?.error;
    if (typeof writer !== "function") return;

    writer.call(this.logger, "Interaction error", this.safeDiagnostics(error, originalError, context));
  }

  logDeliveryFailure(deliveryError, handledError, context) {
    const writer = this.logger?.warn || this.logger?.error;
    if (typeof writer !== "function") return;

    writer.call(this.logger, "Interaction error response was not delivered", {
      ...this.safeContext(context),
      handledCode: handledError.code,
      deliveryErrorType: deliveryError?.name || typeof deliveryError,
      deliveryErrorCode: this.safeScalarCode(deliveryError?.code),
      httpStatus: this.safeScalarCode(deliveryError?.status),
    });
  }

  safeDiagnostics(error, originalError, context) {
    const metadata = {};
    for (const [key, value] of Object.entries(error.metadata || {})) {
      if (SAFE_METADATA_KEYS.has(key) && this.isSafeScalar(value)) metadata[key] = value;
    }

    return {
      ...this.safeContext(context),
      code: error.code,
      errorType: originalError?.name || typeof originalError,
      causeCode: this.safeScalarCode(originalError?.code || originalError?.cause?.code),
      retryable: error.retryable,
      terminal: error.terminal,
      ...metadata,
    };
  }

  safeContext(context) {
    return {
      guildId: this.safeIdentifier(context?.guildId),
      channelId: this.safeIdentifier(context?.channelId),
      userId: this.safeIdentifier(context?.userId),
    };
  }

  safeIdentifier(value) {
    return typeof value === "string" && /^\d{1,32}$/.test(value) ? value : null;
  }

  safeScalarCode(value) {
    return typeof value === "string" || typeof value === "number" ? value : null;
  }

  isSafeScalar(value) {
    return value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string";
  }
}

module.exports = { ErrorResponder };
