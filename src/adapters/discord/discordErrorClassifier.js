"use strict";

const {
  CivratError,
  InteractionExpiredError,
  InteractionAlreadyAcknowledgedError,
  DiscordPermissionError,
  DiscordResourceNotFoundError,
  DiscordUnavailableError,
  ValidationError,
} = require("../../core/errors");

const DiscordErrorCategory = Object.freeze({
  INTERACTION_EXPIRED: "INTERACTION_EXPIRED",
  INTERACTION_ALREADY_ACKNOWLEDGED: "INTERACTION_ALREADY_ACKNOWLEDGED",
  MISSING_ACCESS: "MISSING_ACCESS",
  MISSING_PERMISSIONS: "MISSING_PERMISSIONS",
  RESOURCE_NOT_FOUND: "RESOURCE_NOT_FOUND",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  RATE_LIMITED: "RATE_LIMITED",
  UNAVAILABLE: "UNAVAILABLE",
  UNKNOWN: "UNKNOWN",
});

const UNKNOWN_RESOURCE_CODES = new Set([
  10003, // Unknown Channel
  10004, // Unknown Guild
  10007, // Unknown Member
  10008, // Unknown Message
  10009, // Unknown Permission Overwrite
  10011, // Unknown Role
  10013, // Unknown User
  10014, // Unknown Emoji
  10015, // Unknown Webhook
  10026, // Unknown Ban
  10038, // Unknown Application Command
  10049, // Unknown Application Command Permissions
  10067, // Unknown Stage Instance
  10087, // Unknown Guild Member Verification Form
  10096, // Unknown Webhook Token
]);

const NETWORK_CODES = new Set([
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETDOWN",
  "ENETUNREACH",
  "ENOTFOUND",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
]);

function firstCode(error) {
  const candidates = [
    error?.code,
    error?.rawError?.code,
    error?.data?.code,
    error?.cause?.code,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
    if (typeof candidate === "string" && /^\d+$/.test(candidate)) return Number(candidate);
    if (typeof candidate === "string" && candidate) return candidate.toUpperCase();
  }
  return null;
}

function firstHttpStatus(error) {
  const candidates = [error?.status, error?.statusCode, error?.response?.status, error?.rawError?.status];
  for (const candidate of candidates) {
    const status = Number(candidate);
    if (Number.isInteger(status) && status >= 100 && status <= 599) return status;
  }
  return null;
}

function classifyDiscordError(error) {
  const code = firstCode(error);
  const httpStatus = firstHttpStatus(error);
  const message = typeof error?.message === "string" ? error.message.toLowerCase() : "";

  let category = DiscordErrorCategory.UNKNOWN;
  let retryable = false;
  let terminal = false;
  let recoverable = false;

  if (code === 10062 || (code === null && message.includes("unknown interaction"))) {
    category = DiscordErrorCategory.INTERACTION_EXPIRED;
    terminal = true;
  } else if (code === 40060 || (code === null && message.includes("already been acknowledged"))) {
    category = DiscordErrorCategory.INTERACTION_ALREADY_ACKNOWLEDGED;
    terminal = true;
    recoverable = true;
  } else if (code === 50001) {
    category = DiscordErrorCategory.MISSING_ACCESS;
  } else if (code === 50013) {
    category = DiscordErrorCategory.MISSING_PERMISSIONS;
  } else if (typeof code === "number" && UNKNOWN_RESOURCE_CODES.has(code)) {
    category = DiscordErrorCategory.RESOURCE_NOT_FOUND;
  } else if (code === 50035 || httpStatus === 400) {
    category = DiscordErrorCategory.VALIDATION_FAILED;
  } else if (httpStatus === 429 || code === 20028 || code === 20029) {
    category = DiscordErrorCategory.RATE_LIMITED;
    retryable = true;
  } else if ((typeof code === "string" && NETWORK_CODES.has(code)) || (httpStatus !== null && httpStatus >= 500)) {
    category = DiscordErrorCategory.UNAVAILABLE;
    retryable = true;
  }

  return Object.freeze({
    category,
    kind: category,
    code,
    discordCode: typeof code === "number" ? code : null,
    networkCode: typeof code === "string" ? code : null,
    httpStatus,
    retryable,
    terminal,
    recoverable,
  });
}

function isTerminalInteractionError(error) {
  return classifyDiscordError(error).terminal;
}

function toCivratError(error, metadata = {}) {
  if (error instanceof CivratError) return error;

  const classified = classifyDiscordError(error);
  const safeMetadata = {
    ...metadata,
    classification: classified.category,
    discordCode: classified.discordCode,
    httpStatus: classified.httpStatus,
  };

  switch (classified.category) {
    case DiscordErrorCategory.INTERACTION_EXPIRED:
      return new InteractionExpiredError(safeMetadata, error);
    case DiscordErrorCategory.INTERACTION_ALREADY_ACKNOWLEDGED:
      return new InteractionAlreadyAcknowledgedError(safeMetadata, error);
    case DiscordErrorCategory.MISSING_ACCESS:
    case DiscordErrorCategory.MISSING_PERMISSIONS:
      return new DiscordPermissionError(safeMetadata, error);
    case DiscordErrorCategory.RESOURCE_NOT_FOUND:
      return new DiscordResourceNotFoundError(safeMetadata, error);
    case DiscordErrorCategory.RATE_LIMITED:
    case DiscordErrorCategory.UNAVAILABLE:
      return new DiscordUnavailableError(safeMetadata, error);
    case DiscordErrorCategory.VALIDATION_FAILED:
      return new ValidationError("Discord rejected an invalid request", safeMetadata);
    default:
      return error;
  }
}

module.exports = {
  DiscordErrorCategory,
  classifyDiscordError,
  isTerminalInteractionError,
  toCivratError,
};
