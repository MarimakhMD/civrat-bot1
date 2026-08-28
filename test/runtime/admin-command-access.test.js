"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { config } = require("../../src/config");
const { dictionaries } = require("../../src/core/i18n");
const { createGuildSettingsRuntime } = require("../../src/runtime/createGuildSettingsRuntime");

function legacyConfig() {
  const value = { language: "en" };
  return {
    getGuildConfig: async () => value,
    getGuildConfigState: async () => ({ config: value, available: true, found: true, source: "database" }),
    updateGuildConfig: async (_guildId, patch) => Object.assign(value, patch),
    invalidateCache: async () => {},
  };
}

function adminInteraction({ guildId, channelId, hasRole, captured }) {
  const interaction = {
    isChatInputCommand: () => true,
    isAutocomplete: () => false,
    isButton: () => false,
    isStringSelectMenu: () => false,
    isChannelSelectMenu: () => false,
    isRoleSelectMenu: () => false,
    isModalSubmit: () => false,
    commandName: "admin",
    guildId,
    channelId,
    locale: "en-US",
    user: { id: "222222222222222222" },
    member: guildId ? {
      id: "222222222222222222",
      permissions: { has: () => true },
      roles: { cache: { has: (roleId) => Boolean(hasRole) && roleId === config.civratAdminRoleId } },
    } : null,
    client: {
      isReady: () => true,
      guilds: { cache: new Map() },
    },
    reply: async (payload) => { captured.reply = payload; },
    followUp: async (payload) => { captured.followUp = payload; },
    update: async (payload) => { captured.update = payload; },
  };
  return interaction;
}

function serialized(payload) {
  return JSON.stringify(payload || {});
}

test("/admin opens only in the configured technical guild, channel, and role", async () => {
  const runtime = createGuildSettingsRuntime({ legacyConfigService: legacyConfig() });
  const allowed = {};
  const handled = await runtime.tryHandle(adminInteraction({
    guildId: config.civratAdminGuildId,
    channelId: config.civratAdminChannelId,
    hasRole: true,
    captured: allowed,
  }));
  assert.equal(handled, true);
  assert.match(serialized(allowed.reply), /CIVRAT dashboard/);
});

test("three nontechnical guilds, wrong channel, missing role, and DM receive the same generic refusal", async () => {
  const runtime = createGuildSettingsRuntime({ legacyConfigService: legacyConfig() });
  const scenarios = [
    { guildId: "900000000000000001", channelId: config.civratAdminChannelId, hasRole: true },
    { guildId: "900000000000000002", channelId: config.civratAdminChannelId, hasRole: true },
    { guildId: "900000000000000003", channelId: config.civratAdminChannelId, hasRole: true },
    { guildId: config.civratAdminGuildId, channelId: "900000000000000004", hasRole: true },
    { guildId: config.civratAdminGuildId, channelId: config.civratAdminChannelId, hasRole: false },
    { guildId: null, channelId: null, hasRole: false },
  ];
  const payloads = [];
  for (const scenario of scenarios) {
    const captured = {};
    assert.equal(await runtime.tryHandle(adminInteraction({ ...scenario, captured })), true);
    assert.ok(captured.reply || captured.followUp, "denial must be acknowledged");
    const payload = captured.reply || captured.followUp;
    const json = serialized(payload);
    assert.equal(json.includes("Premium servers"), false);
    assert.equal(json.includes(config.civratAdminGuildId), false);
    assert.equal(json.includes(config.civratAdminChannelId), false);
    assert.equal(json.includes(config.civratAdminRoleId), false);
    assert.equal(payload.ephemeral, true);
    assert.deepEqual(Object.keys(payload).sort(), ["content", "ephemeral"]);
    assert.ok([
      dictionaries.en.errors.authorizationDenied,
      dictionaries.fr.errors.authorizationDenied,
    ].includes(payload.content));
    payloads.push(json);
  }
  assert.equal(new Set(payloads.slice(0, 5)).size, 1, "guild denial cases must be indistinguishable");
});
