"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { SuggestionConfigService, SUGGESTION_DEFAULTS } = require("../services/SuggestionConfigService");

test("read merges defaults", async () => {
  const svc = new SuggestionConfigService({ guildConfigResolver: { get: async () => ({ suggestion_enabled: true }), update: async () => ({}) } });
  const config = await svc.read("g");
  assert.equal(config.suggestion_enabled, true);
  assert.equal(config.suggestion_channel_id, SUGGESTION_DEFAULTS.suggestion_channel_id);
});

test("read returns defaults when empty", async () => {
  const svc = new SuggestionConfigService({ guildConfigResolver: { get: async () => null, update: async () => ({}) } });
  const config = await svc.read("g");
  assert.deepEqual(config, SUGGESTION_DEFAULTS);
});

test("update and ctor guard", async () => {
  let stored = {};
  const svc = new SuggestionConfigService({ guildConfigResolver: { get: async () => stored, update: async (g, u) => (stored = { ...stored, ...u }) } });
  await svc.update("g", { suggestion_enabled: true });
  assert.equal(stored.suggestion_enabled, true);
  assert.throws(() => new SuggestionConfigService({}), /guildConfigResolver/);
});
