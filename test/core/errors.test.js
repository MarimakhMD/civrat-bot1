"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  AuthorizationError,
  BackendUnavailableError,
  ErrorCode,
  ErrorResponder,
  InteractionExpiredError,
} = require("../../src/core/errors");
const { dictionaries, I18nService } = require("../../src/core/i18n");

function makeContext(locale) {
  const i18n = new I18nService({ dictionaries });
  return {
    guildId: "1320817768962064384",
    channelId: "1542957356382552154",
    userId: "222222222222222222",
    t: i18n.forLocale(locale),
  };
}

function recordingTransport() {
  const replies = [];
  return {
    replies,
    async replyError(payload) {
      replies.push(payload);
      return { id: "response" };
    },
  };
}

test("error responder renders safe domain errors in the requested locale", async () => {
  const transport = recordingTransport();
  const result = await new ErrorResponder().respond({
    error: new AuthorizationError(),
    context: makeContext("fr"),
    transport,
  });

  assert.equal(result.code, ErrorCode.AUTHORIZATION_DENIED);
  assert.equal(result.delivered, true);
  assert.equal(result.terminal, false);
  assert.equal(transport.replies.length, 1);
  assert.equal(transport.replies[0].message, "Vous n’avez pas la permission d’effectuer cette action.");
  assert.deepEqual(transport.replies[0].details, {});
});

test("unexpected technical messages are neither exposed nor handed to an injected logger", async () => {
  const privateDetail = "database connection credential=must-never-appear";
  const transport = recordingTransport();
  const logs = [];
  const result = await new ErrorResponder({
    logger: { error: (message, payload) => logs.push({ message, payload }) },
  }).respond({
    error: new Error(privateDetail),
    context: makeContext("en"),
    transport,
  });

  assert.equal(result.code, ErrorCode.INTERNAL_ERROR);
  assert.equal(transport.replies[0].message, "An unexpected error occurred. Please try again later.");
  assert.equal(JSON.stringify(logs).includes(privateDetail), false);
  assert.equal(logs[0].payload.code, ErrorCode.INTERNAL_ERROR);
  assert.equal(logs[0].payload.errorType, "Error");
});

test("terminal interaction errors are observed without attempting another Discord response", async () => {
  let replyCalls = 0;
  const logs = [];
  const result = await new ErrorResponder({
    logger: { warn: (message, payload) => logs.push({ message, payload }) },
  }).respond({
    error: new InteractionExpiredError({ classification: "INTERACTION_EXPIRED", discordCode: 10062 }),
    context: makeContext("fr"),
    transport: { replyError: async () => { replyCalls += 1; } },
  });

  assert.equal(result.code, ErrorCode.INTERACTION_EXPIRED);
  assert.equal(result.delivered, false);
  assert.equal(result.terminal, true);
  assert.equal(replyCalls, 0);
  assert.equal(logs[0].payload.discordCode, 10062);
});

test("backend unavailability says that no change was saved", async () => {
  const transport = recordingTransport();
  const result = await new ErrorResponder().respond({
    error: new BackendUnavailableError({ operation: "write", resource: "guild_config" }),
    context: makeContext("en"),
    transport,
  });

  assert.equal(result.code, ErrorCode.BACKEND_UNAVAILABLE);
  assert.match(result.message, /No change was saved/);
  assert.equal(result.delivered, true);
});

test("a response delivery failure is observable but does not reject the router path", async () => {
  const privateDetail = "credential=must-never-appear";
  const logs = [];
  const responder = new ErrorResponder({
    logger: { warn: (message, payload) => logs.push({ message, payload }) },
  });

  const result = await responder.respond({
    error: new BackendUnavailableError({ operation: "read", resource: "guild_config" }),
    context: makeContext("fr"),
    transport: {
      replyError: async () => {
        const error = new Error(privateDetail);
        error.code = 10062;
        throw error;
      },
    },
  });

  assert.equal(result.delivered, false);
  assert.equal(result.terminal, false);
  assert.equal(JSON.stringify(logs).includes(privateDetail), false);
  assert.equal(logs.at(-1).payload.deliveryErrorCode, 10062);
});
