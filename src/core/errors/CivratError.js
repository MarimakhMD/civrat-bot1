"use strict";

const { ErrorCode } = require("./errorCodes");

/**
 * Base error for expected domain failures. It deliberately contains no
 * transport-specific behavior: Discord, HTTP, and future transports can render
 * the same error through their own adapters.
 */
class CivratError extends Error {
  constructor({ code, translationKey, message, metadata = {}, cause, isUserSafe = true }) {
    super(message || code, cause ? { cause } : undefined);
    this.name = this.constructor.name;
    this.code = code;
    this.translationKey = translationKey;
    this.metadata = Object.freeze({ ...metadata });
    this.isUserSafe = isUserSafe;
  }
}

class AuthorizationError extends CivratError {
  constructor(metadata = {}) {
    super({ code: ErrorCode.AUTHORIZATION_DENIED, translationKey: "errors.authorizationDenied", metadata });
  }
}

class ConfigurationError extends CivratError {
  constructor(code = ErrorCode.CONFIGURATION_UNAVAILABLE, metadata = {}, cause) {
    const translationKey = code === ErrorCode.CONFIGURATION_INVALID
      ? "errors.configurationInvalid"
      : "errors.configurationUnavailable";
    super({ code, translationKey, metadata, cause, isUserSafe: true });
  }
}

class NotFoundError extends CivratError {
  constructor(metadata = {}) {
    super({ code: ErrorCode.RESOURCE_NOT_FOUND, translationKey: "errors.resourceNotFound", metadata });
  }
}

class RouteNotFoundError extends CivratError {
  constructor(metadata = {}) {
    super({ code: ErrorCode.ROUTE_NOT_FOUND, translationKey: "errors.routeNotFound", metadata });
  }
}

class UnsupportedInteractionError extends CivratError {
  constructor(metadata = {}) {
    super({ code: ErrorCode.INTERACTION_UNSUPPORTED, translationKey: "errors.interactionUnsupported", metadata });
  }
}

class ValidationError extends CivratError {
  constructor(metadata = {}) {
    super({ code: ErrorCode.VALIDATION_FAILED, translationKey: "errors.validationFailed", metadata });
  }
}

module.exports = {
  CivratError,
  AuthorizationError,
  ConfigurationError,
  NotFoundError,
  RouteNotFoundError,
  UnsupportedInteractionError,
  ValidationError,
};
