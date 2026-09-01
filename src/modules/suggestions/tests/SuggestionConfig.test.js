"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { SuggestionConfigService, SUGGESTION_DEFAULTS } = require("../services/SuggestionConfigService");

test("read merges defaults", async () => {
  const svc = new SuggestionConfigService({ guildConfigResolver: { get: async () => ({ suggestions_enabled: true }), update: async () => ({}) } });
  const config = await svc.read("g");
  assert.equal(config.suggestions_enabled, true);
  assert.equal(config.suggestions_channel_id, SUGGESTION_DEFAULTS.suggestions_channel_id);
});

test("read returns defaults when empty", async () => {
  const svc = new SuggestionConfigService({ guildConfigResolver: { get: async () => null, update: async () => ({}) } });
  const config = await svc.read("g");
  assert.deepEqual(config, SUGGESTION_DEFAULTS);
});

test("update and ctor guard", async () => {
  let stored = {};
  const svc = new SuggestionConfigService({ guildConfigResolver: { get: async () => stored, update: async (g, u) => (stored = { ...stored, ...u }) } });
  await svc.update("g", { suggestions_enabled: true });
  assert.equal(stored.suggestions_enabled, true);
  assert.throws(() => new SuggestionConfigService({}), /guildConfigResolver/);
});
