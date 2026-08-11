"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { AnalyticsConfigService, ANALYTICS_DEFAULTS } = require("../services/AnalyticsConfigService");

test("read merges defaults", async () => {
  const svc = new AnalyticsConfigService({ guildConfigResolver: { get: async () => ({ analytics_enabled: true }), update: async () => ({}) } });
  const config = await svc.read("g");
  assert.equal(config.analytics_enabled, true);
  assert.equal(config.analytics_channel_id, ANALYTICS_DEFAULTS.analytics_channel_id);
});

test("read returns defaults when empty", async () => {
  const svc = new AnalyticsConfigService({ guildConfigResolver: { get: async () => null, update: async () => ({}) } });
  const config = await svc.read("g");
  assert.deepEqual(config, ANALYTICS_DEFAULTS);
});

test("update and ctor guard", async () => {
  let stored = {};
  const svc = new AnalyticsConfigService({ guildConfigResolver: { get: async () => stored, update: async (g, u) => (stored = { ...stored, ...u }) } });
  await svc.update("g", { analytics_enabled: true });
  assert.equal(stored.analytics_enabled, true);
  assert.throws(() => new AnalyticsConfigService({}), /guildConfigResolver/);
});
