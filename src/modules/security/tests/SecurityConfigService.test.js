"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { SecurityConfigService, SECURITY_DEFAULTS } = require("../services/SecurityConfigService");

test("read merges stored config with safe defaults", async () => {
  const stored = { security_enabled: true, security_whitelist: ["123"] };
  const service = new SecurityConfigService({ guildConfigResolver: { get: async () => stored, update: async () => ({}) } });
  const config = await service.read("g");
  assert.equal(config.security_enabled, true);
  assert.deepEqual(config.security_whitelist, ["123"]);
  assert.equal(config.security_anti_raid, SECURITY_DEFAULTS.security_anti_raid);
  assert.equal(config.security_anti_bot, SECURITY_DEFAULTS.security_anti_bot);
  assert.equal(config.security_anti_nuke, SECURITY_DEFAULTS.security_anti_nuke);
});

test("read returns defaults when no stored config", async () => {
  const service = new SecurityConfigService({ guildConfigResolver: { get: async () => null, update: async () => ({}) } });
  const config = await service.read("g");
  assert.equal(config.security_enabled, false);
  assert.deepEqual(config.security_whitelist, []);
  assert.equal(config.security_log_channel_id, null);
});

test("update writes through the resolver", async () => {
  let config = {};
  const service = new SecurityConfigService({ guildConfigResolver: { get: async () => config, update: async (g, patch) => (config = { ...config, ...patch }) } });
  await service.update("g", { security_enabled: true, security_anti_raid: true });
  assert.deepEqual(config, { security_enabled: true, security_anti_raid: true });
});

test("constructor rejects a missing resolver", () => {
  assert.throws(() => new SecurityConfigService({}), /guildConfigResolver/);
});
