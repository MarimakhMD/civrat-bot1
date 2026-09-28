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

test("Security whitelist modal opens through envelope.transport and prefills current entries", async () => {
  let config = { security_whitelist: ["111111111111111", "222222222222222"] };
  const service = { read: async () => config, update: async (_g, patch) => (config = { ...config, ...patch }) };
  let modal = null;
  const envelope = { transport: { showModal: async (m) => { modal = m; } } };
  await openWhitelist({ t: (k) => k, service, guildId: "g", envelope });
  assert.equal(modal.customId, Id.WHITELIST_MODAL);
  assert.equal(modal.fields[0].id, "whitelist");
  // préremplissage conservé : la liste courante est join(", ")
  assert.equal(modal.fields[0].value, "111111111111111, 222222222222222");
  // P9 — maxLength explicite sur le champ (appliqué au TextInput par le transport)
  assert.equal(modal.fields[0].maxLength, 4000);
  assert.equal(modal.fields[0].required, false);
});

test("Security whitelist submit persists trimmed valid entries from envelope.modalValues", async () => {
  let config = { security_whitelist: ["111111111111111"] };
  const service = { read: async () => config, update: async (_g, patch) => (config = { ...config, ...patch }) };
  await submitWhitelist({ service, guildId: "g", envelope: { modalValues: { whitelist: "222222222222222, 333333333333333 , " } } });
  assert.deepEqual(config.security_whitelist, ["222222222222222", "333333333333333"]);
  await submitWhitelist({ service, guildId: "g", envelope: { modalValues: { whitelist: "" } } });
  assert.deepEqual(config.security_whitelist, []);
});
