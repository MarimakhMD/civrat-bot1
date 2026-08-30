"use strict";

const { ErrorCode } = require("./errorCodes");

class CivratError extends Error {
  constructor({
    code,
    message,
    translationKey,
    metadata = {},
    cause = null,
    isUserSafe = true,
    retryable = false,
    terminal = false,
    reportLevel = "error",
  }) {
    super(message || code, cause ? { cause } : undefined);
    this.name = this.constructor.name;
    this.code = code;
    this.translationKey = translationKey;
    this.metadata = Object.freeze({ ...metadata });
    this.isUserSafe = Boolean(isUserSafe);
    this.retryable = Boolean(retryable);
    this.terminal = Boolean(terminal);
    this.reportLevel = reportLevel;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

function messageAndMetadata(defaultMessage, messageOrMetadata, metadata) {
  if (messageOrMetadata && typeof messageOrMetadata === "object" && !Array.isArray(messageOrMetadata)) {
    return { message: defaultMessage, metadata: messageOrMetadata };
  }
  return {
    message: typeof messageOrMetadata === "string" && messageOrMetadata ? messageOrMetadata : defaultMessage,
    metadata: metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {},
  };
}

class ValidationError extends CivratError {
  constructor(messageOrMetadata = {}, metadata = {}) {
    const normalized = messageAndMetadata("Validation failed", messageOrMetadata, metadata);
    super({
      code: ErrorCode.VALIDATION_FAILED,
      message: normalized.message,
      translationKey: "errors.validationFailed",
      metadata: normalized.metadata,
      reportLevel: "warn",
    });
  }
}

class AuthorizationError extends CivratError {
  constructor(messageOrMetadata = {}, metadata = {}) {
    const normalized = messageAndMetadata("Authorization denied", messageOrMetadata, metadata);
    super({
      code: ErrorCode.AUTHORIZATION_DENIED,
      message: normalized.message,
      translationKey: "errors.authorizationDenied",
      metadata: normalized.metadata,
      reportLevel: "warn",
    });
  }
}

class ResourceNotFoundError extends CivratError {
  constructor(messageOrMetadata = {}, metadata = {}) {
    const normalized = messageAndMetadata("Resource not found", messageOrMetadata, metadata);
    super({
      code: ErrorCode.RESOURCE_NOT_FOUND,
      message: normalized.message,
      translationKey: "errors.resourceNotFound",
      metadata: normalized.metadata,
      reportLevel: "warn",
    });
  }
}

class NotFoundError extends CivratError {
  constructor(metadata = {}) {
    super({
      code: ErrorCode.RESOURCE_NOT_FOUND,
      message: "Resource not found",
      translationKey: "errors.resourceNotFound",
      metadata,
      reportLevel: "warn",
    });
  }
}

class RouteNotFoundError extends CivratError {
  constructor(metadata = {}) {
    super({
      code: ErrorCode.ROUTE_NOT_FOUND,
      message: "Interaction route not found",
      translationKey: "errors.routeNotFound",
      metadata,
      reportLevel: "warn",
    });
  }
}

class UnsupportedInteractionError extends CivratError {
  constructor(metadata = {}) {
    super({
      code: ErrorCode.INTERACTION_UNSUPPORTED,
      message: "Interaction unsupported",
      translationKey: "errors.interactionUnsupported",
      metadata,
      reportLevel: "warn",
    });
  }
}

class ConfigurationError extends CivratError {
  constructor(codeOrMessage = ErrorCode.CONFIGURATION_UNAVAILABLE, metadata = {}, cause = null) {
    const knownCode = codeOrMessage === ErrorCode.CONFIGURATION_INVALID
      || codeOrMessage === ErrorCode.CONFIGURATION_UNAVAILABLE;
    const metadataOnly = codeOrMessage && typeof codeOrMessage === "object" && !Array.isArray(codeOrMessage);
    const code = knownCode ? codeOrMessage : ErrorCode.CONFIGURATION_UNAVAILABLE;
    const normalizedMetadata = metadataOnly ? codeOrMessage : metadata;
    const message = knownCode
      ? code
      : typeof codeOrMessage === "string"
        ? codeOrMessage
        : "Configuration unavailable";
    super({
      code,
      message,
      translationKey: code === ErrorCode.CONFIGURATION_INVALID
        ? "errors.configurationInvalid"
        : "errors.configurationUnavailable",
      metadata: normalizedMetadata,
      cause,
      reportLevel: "error",
    });
  }
}

class BackendUnavailableError extends CivratError {
  constructor(metadata = {}, cause = null) {
    super({
      code: ErrorCode.BACKEND_UNAVAILABLE,
      message: "Backend unavailable",
      translationKey: "errors.backendUnavailable",
      metadata,
      cause,
      retryable: true,
      reportLevel: "warn",
    });
  }
}

const PERSISTENCE_TRANSLATION_KEYS = Object.freeze({
  [ErrorCode.PERSISTENCE_FAILED]: "errors.persistenceFailed",
  [ErrorCode.PERSISTENCE_CONFLICT]: "errors.persistenceConflict",
  [ErrorCode.PERSISTENCE_SCHEMA_MISMATCH]: "errors.persistenceSchemaMismatch",
  [ErrorCode.PERSISTENCE_PERMISSION_DENIED]: "errors.persistencePermissionDenied",
});

class PersistenceError extends CivratError {
  constructor({ code = ErrorCode.PERSISTENCE_FAILED, metadata = {}, cause = null, retryable = false } = {}) {
    const normalizedCode = Object.hasOwn(PERSISTENCE_TRANSLATION_KEYS, code)
      ? code
      : ErrorCode.PERSISTENCE_FAILED;
    super({
      code: normalizedCode,
      message: "Persistence operation failed",
      translationKey: PERSISTENCE_TRANSLATION_KEYS[normalizedCode],
      metadata,
      cause,
      retryable,
      reportLevel: normalizedCode === ErrorCode.PERSISTENCE_CONFLICT ? "warn" : "error",
    });
  }
}

class PremiumRequiredError extends CivratError {
  constructor(metadata = {}) {
    super({
      code: ErrorCode.PREMIUM_REQUIRED,
      message: "Premium entitlement required",
      translationKey: "errors.premiumRequired",
      metadata,
      reportLevel: "warn",
    });
  }
}

class EntitlementUnavailableError extends CivratError {
  constructor(metadata = {}, cause = null) {
    super({
      code: ErrorCode.ENTITLEMENT_UNAVAILABLE,
      message: "Entitlement state is unavailable",
      translationKey: "errors.entitlementUnavailable",
      metadata,
      cause,
      retryable: true,
      reportLevel: "warn",
    });
  }
}

class InteractionExpiredError extends CivratError {
  constructor(metadata = {}, cause = null) {
    super({
      code: ErrorCode.INTERACTION_EXPIRED,
      message: "Discord interaction expired",
      translationKey: "errors.interactionExpired",
      metadata,
      cause,
      terminal: true,
      reportLevel: "warn",
    });
  }
}

class InteractionAlreadyAcknowledgedError extends CivratError {
  constructor(metadata = {}, cause = null) {
    super({
      code: ErrorCode.INTERACTION_ALREADY_ACKNOWLEDGED,
      message: "Discord interaction already acknowledged",
      translationKey: "errors.interactionAlreadyAcknowledged",
      metadata,
      cause,
      terminal: true,
      reportLevel: "warn",
    });
  }
}

class DiscordPermissionError extends CivratError {
  constructor(metadata = {}, cause = null) {
    super({
      code: ErrorCode.DISCORD_PERMISSION_DENIED,
      message: "Discord permission denied",
      translationKey: "errors.discordPermissionDenied",
      metadata,
      cause,
      reportLevel: "warn",
    });
  }
}

class DiscordResourceNotFoundError extends CivratError {
  constructor(metadata = {}, cause = null) {
    super({
      code: ErrorCode.DISCORD_RESOURCE_NOT_FOUND,
      message: "Discord resource no longer exists",
      translationKey: "errors.discordResourceNotFound",
      metadata,
      cause,
      reportLevel: "warn",
    });
  }
}

class DiscordUnavailableError extends CivratError {
  constructor(metadata = {}, cause = null) {
    super({
      code: ErrorCode.DISCORD_UNAVAILABLE,
      message: "Discord unavailable",
      translationKey: "errors.discordUnavailable",
      metadata,
      cause,
      retryable: true,
      reportLevel: "warn",
    });
  }
}

module.exports = {
  CivratError,
  ValidationError,
  AuthorizationError,
  ResourceNotFoundError,
  NotFoundError,
  RouteNotFoundError,
  UnsupportedInteractionError,
  ConfigurationError,
  BackendUnavailableError,
  PersistenceError,
  PremiumRequiredError,
  EntitlementUnavailableError,
  InteractionExpiredError,
  InteractionAlreadyAcknowledgedError,
  DiscordPermissionError,
  DiscordResourceNotFoundError,
  DiscordUnavailableError,
};
