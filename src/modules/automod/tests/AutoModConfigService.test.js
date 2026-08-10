"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { AutoModConfigService, AUTOMOD_DEFAULTS } = require("../services/AutoModConfigService");

test("read merges stored config with safe defaults", async () => {
  const stored = { automod_enabled: true, automod_bad_words: ["x"] };
  const service = new AutoModConfigService({ guildConfigResolver: { get: async () => stored, update: async () => ({}) } });
  const config = await service.read("g");
  assert.equal(config.automod_enabled, true);
  assert.deepEqual(config.automod_bad_words, ["x"]);
  assert.equal(config.automod_anti_links, AUTOMOD_DEFAULTS.automod_anti_links);
  assert.equal(config.automod_punishment, "none");
});

test("read returns defaults when no stored config", async () => {
  const service = new AutoModConfigService({ guildConfigResolver: { get: async () => null, update: async () => ({}) } });
  const config = await service.read("g");
  assert.equal(config.automod_enabled, false);
  assert.deepEqual(config.automod_bad_words, []);
});

test("update writes through the resolver", async () => {
  let config = {};
  const service = new AutoModConfigService({ guildConfigResolver: { get: async () => config, update: async (g, patch) => (config = { ...config, ...patch }) } });
  await service.update("g", { automod_enabled: true, automod_anti_links: true });
  assert.deepEqual(config, { automod_enabled: true, automod_anti_links: true });
});

test("constructor rejects a missing resolver", () => {
  assert.throws(() => new AutoModConfigService({}), /guildConfigResolver/);
});
