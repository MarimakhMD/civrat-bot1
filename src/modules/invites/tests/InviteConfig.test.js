"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { InviteConfigService, INVITE_DEFAULTS } = require("../services/InviteConfigService");

test("read merges defaults", async () => {
  const svc = new InviteConfigService({ guildConfigResolver: { get: async () => ({ invitations_enabled: true }), update: async () => ({}) } });
  const config = await svc.read("g");
  assert.equal(config.invitations_enabled, true);
  assert.equal(config.invitations_log_channel_id, INVITE_DEFAULTS.invitations_log_channel_id);
});

test("read returns defaults when empty", async () => {
  const svc = new InviteConfigService({ guildConfigResolver: { get: async () => null, update: async () => ({}) } });
  const config = await svc.read("g");
  assert.deepEqual(config, INVITE_DEFAULTS);
});

test("update and ctor guard", async () => {
  let stored = {};
  const svc = new InviteConfigService({ guildConfigResolver: { get: async () => stored, update: async (g, u) => (stored = { ...stored, ...u }) } });
  await svc.update("g", { invitations_enabled: true });
  assert.equal(stored.invitations_enabled, true);
  assert.throws(() => new InviteConfigService({}), /guildConfigResolver/);
});
