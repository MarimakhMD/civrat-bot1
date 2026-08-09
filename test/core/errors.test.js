"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { AuthorizationError, ErrorResponder } = require("../../src/core/errors");
const { dictionaries, I18nService } = require("../../src/core/i18n");
const { createFakeErrorTransport } = require("../../src/core/testing/fakeInteraction");

function makeContext(locale) {
  const i18n = new I18nService({ dictionaries });
  return { guildId: "guild", userId: "user", t: i18n.forLocale(locale) };
}

test("error responder renders safe domain errors in the requested locale", async () => {
  const transport = createFakeErrorTransport();
  const result = await new ErrorResponder().respond({ error: new AuthorizationError(), context: makeContext("fr"), transport });
  assert.equal(result.code, "AUTHORIZATION_DENIED");
  assert.deepEqual(transport.replies, [{ message: "Vous n’avez pas la permission d’effectuer cette action.", ephemeral: true }]);
});

test("error responder protects users from unexpected technical errors and logs details", async () => {
  const transport = createFakeErrorTransport();
  const logs = [];
  await new ErrorResponder({ logger: { error: (_message, payload) => logs.push(payload) } }).respond({
    error: new Error("database connection token=secret"),
    context: makeContext("en"),
    transport,
  });
  assert.equal(transport.replies[0].message, "An unexpected error occurred. Please try again later.");
  assert.equal(logs[0].code, "INTERNAL_ERROR");
  assert.match(logs[0].error, /database connection/);
});
