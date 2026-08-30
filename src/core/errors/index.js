"use strict";

const { ErrorCode } = require("./errorCodes");
const {
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
} = require("./CivratError");
const { ErrorResponder } = require("./errorResponder");

module.exports = {
  ErrorCode,
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
  ErrorResponder,
};
