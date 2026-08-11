"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { TempVoiceConfigService, TEMPVOICE_DEFAULTS } = require("../services/TempVoiceConfigService");

test("read merges defaults", async () => {
  const svc = new TempVoiceConfigService({ guildConfigResolver: { get: async () => ({ tempvoice_enabled: true }), update: async () => ({}) } });
  const config = await svc.read("g");
  assert.equal(config.tempvoice_enabled, true);
  assert.equal(config.tempvoice_lobby_channel_id, TEMPVOICE_DEFAULTS.tempvoice_lobby_channel_id);
});

test("read returns defaults when empty", async () => {
  const svc = new TempVoiceConfigService({ guildConfigResolver: { get: async () => null, update: async () => ({}) } });
  const config = await svc.read("g");
  assert.deepEqual(config, TEMPVOICE_DEFAULTS);
});

test("update and ctor guard", async () => {
  let stored = {};
  const svc = new TempVoiceConfigService({ guildConfigResolver: { get: async () => stored, update: async (g, u) => (stored = { ...stored, ...u }) } });
  await svc.update("g", { tempvoice_enabled: true });
  assert.equal(stored.tempvoice_enabled, true);
  assert.throws(() => new TempVoiceConfigService({}), /guildConfigResolver/);
});
