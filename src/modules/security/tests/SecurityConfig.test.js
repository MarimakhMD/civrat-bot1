"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { SecurityComponentId: Id } = require("../configuration/securityConstants");
const { toggleSecurity, toggleRule, openWhitelist, submitWhitelist } = require("../interactions/configureSecurity");
const { SecurityConfigKey: Key } = require("../configuration/securityConstants");

test("Security configuration persists toggle and whitelist", async () => {
  let config = { security_enabled: false, security_anti_raid: false, security_whitelist: [] };
  const service = { read: async () => config, update: async (_g, patch) => (config = { ...config, ...patch }) };
  const base = { guildId: "g", t: (k) => k, service, envelope: { transport: { update: async () => {}, showModal: async () => {} } } };
  await toggleSecurity(base);
  assert.equal(config.security_enabled, true);
  await toggleRule({ service, guildId: "g", key: Key.ANTI_RAID });
  assert.equal(config.security_anti_raid, true);
  await toggleRule({ service, guildId: "g", key: Key.ANTI_BOT });
  assert.equal(config.security_anti_bot, true);
  await toggleRule({ service, guildId: "g", key: Key.ANTI_NUKE });
  assert.equal(config.security_anti_nuke, true);
});

test("Security whitelist modal and submit", async () => {
  let config = { security_whitelist: ["111"] };
  const service = { read: async () => config, update: async (_g, patch) => (config = { ...config, ...patch }) };
  let modal = null;
  const transport = { showModal: async (m) => { modal = m; } };
  await openWhitelist({ t: (k) => k, service, guildId: "g", transport });
  assert.equal(modal.customId, Id.WHITELIST_MODAL);
  assert.ok(modal.fields[0].value.includes("111"));
  await submitWhitelist({ service, guildId: "g", modalValues: { whitelist: "222, 333 , " } });
  assert.deepEqual(config.security_whitelist, ["222", "333"]);
  await submitWhitelist({ service, guildId: "g", modalValues: { whitelist: "" } });
  assert.deepEqual(config.security_whitelist, []);
});
