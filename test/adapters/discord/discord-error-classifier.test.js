"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ErrorCode, BackendUnavailableError } = require("../../../src/core/errors");
const {
  DiscordErrorCategory,
  classifyDiscordError,
  isTerminalInteractionError,
  toCivratError,
} = require("../../../src/adapters/discord/discordErrorClassifier");

function discordError(code, status = null) {
  const error = new Error("private Discord response detail");
  error.code = code;
  if (status !== null) error.status = status;
  return error;
}

test("unknown interaction is classified as expired and terminal", () => {
  for (const error of [discordError(10062, 404), { rawError: { code: "10062" }, status: 404 }]) {
    const result = classifyDiscordError(error);
    assert.equal(result.category, DiscordErrorCategory.INTERACTION_EXPIRED);
    assert.equal(result.discordCode, 10062);
    assert.equal(result.terminal, true);
    assert.equal(result.recoverable, false);
    assert.equal(isTerminalInteractionError(error), true);
    assert.equal(toCivratError(error).code, ErrorCode.INTERACTION_EXPIRED);
  }
});

test("already acknowledged is terminal but marked recoverable by the transport", () => {
  const error = discordError(40060, 400);
  const result = classifyDiscordError(error);
  assert.equal(result.category, DiscordErrorCategory.INTERACTION_ALREADY_ACKNOWLEDGED);
  assert.equal(result.terminal, true);
  assert.equal(result.recoverable, true);
  assert.equal(toCivratError(error).code, ErrorCode.INTERACTION_ALREADY_ACKNOWLEDGED);
});

test("missing access and missing permissions remain separate classifier categories", () => {
  const access = classifyDiscordError(discordError(50001, 403));
  const permission = classifyDiscordError(discordError(50013, 403));
  assert.equal(access.category, DiscordErrorCategory.MISSING_ACCESS);
  assert.equal(permission.category, DiscordErrorCategory.MISSING_PERMISSIONS);
  assert.equal(toCivratError(discordError(50001)).code, ErrorCode.DISCORD_PERMISSION_DENIED);
  assert.equal(toCivratError(discordError(50013)).code, ErrorCode.DISCORD_PERMISSION_DENIED);
});

test("deleted Discord resources are distinct from expired interactions", () => {
  for (const code of [10003, 10007, 10008, 10011, 10013, 10015]) {
    const result = classifyDiscordError(discordError(code, 404));
    assert.equal(result.category, DiscordErrorCategory.RESOURCE_NOT_FOUND);
    assert.equal(result.terminal, false);
    assert.equal(toCivratError(discordError(code)).code, ErrorCode.DISCORD_RESOURCE_NOT_FOUND);
  }
});

test("rate limiting, network errors and server errors are retryable Discord unavailability", () => {
  for (const error of [discordError("ECONNRESET"), discordError(null, 429), discordError(null, 503)]) {
    const result = classifyDiscordError(error);
    assert.equal(result.retryable, true);
    assert.ok([DiscordErrorCategory.RATE_LIMITED, DiscordErrorCategory.UNAVAILABLE].includes(result.category));
    assert.equal(toCivratError(error).code, ErrorCode.DISCORD_UNAVAILABLE);
  }
});

test("invalid forms map to validation while unknown errors stay untouched", () => {
  assert.equal(toCivratError(discordError(50035, 400)).code, ErrorCode.VALIDATION_FAILED);
  const unknown = discordError("SOMETHING_NEW", 418);
  assert.equal(classifyDiscordError(unknown).category, DiscordErrorCategory.UNKNOWN);
  assert.equal(toCivratError(unknown), unknown);
});

test("existing CIVRAT errors are never flattened into Discord errors", () => {
  const backend = new BackendUnavailableError({ operation: "read" });
  assert.equal(toCivratError(backend), backend);
  assert.equal(toCivratError(backend).code, ErrorCode.BACKEND_UNAVAILABLE);
});

test("classification output never contains the raw Discord message", () => {
  const privateDetail = "private credential marker must never be copied";
  const result = classifyDiscordError(Object.assign(new Error(privateDetail), { code: 50013, status: 403 }));
  assert.equal(JSON.stringify(result).includes(privateDetail), false);
  assert.deepEqual(Object.keys(result).sort(), [
    "category",
    "code",
    "discordCode",
    "httpStatus",
    "kind",
    "networkCode",
    "recoverable",
    "retryable",
    "terminal",
  ]);
});
