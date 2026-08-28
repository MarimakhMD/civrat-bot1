"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { ValidationError } = require("../../../core/errors");
const { EntitlementDecision, EntitlementFeature } = require("../../../core/entitlements");
const { GuildSettingsService, PREMIUM_FEATURES } = require("../services/GuildSettingsService");

test("GuildSettingsService reads and writes language only through the resolver contract", async () => {
  const calls = [];
  const resolver = {
    getLanguage: async () => "fr",
    update: async (id, patch) => { calls.push({ id, patch }); return patch; },
  };
  const service = new GuildSettingsService({ guildConfigResolver: resolver });
  assert.equal(await service.getLanguage("guild"), "fr");
  assert.deepEqual(await service.updateLanguage("guild", "en"), { language: "en" });
  assert.deepEqual(calls, [{ id: "guild", patch: { language: "en" } }]);
  await assert.rejects(() => service.updateLanguage("guild", "de"), ValidationError);
});

test("GuildSettingsService exposes the configuration reader state unchanged", async () => {
  const expected = { config: { tickets_enabled: true }, available: true, found: true, source: "database" };
  const service = new GuildSettingsService({
    guildConfigResolver: { getLanguage: async () => "fr", update: async () => ({}) },
    configurationReader: async (guildId) => ({ ...expected, guildId }),
  });
  assert.deepEqual(await service.getConfigurationState("guild"), { ...expected, guildId: "guild" });
});

test("GuildSettingsService checks only catalogued Premium capabilities", async () => {
  const calls = [];
  const service = new GuildSettingsService({
    guildConfigResolver: { getLanguage: async () => "fr", update: async () => ({}) },
    configurationReader: async () => ({}),
    entitlementService: {
      requireFeature: async ({ guildId, feature }) => {
        calls.push({ guildId, feature });
        return { ok: true, granted: true, code: EntitlementDecision.GRANTED };
      },
    },
  });
  const decisions = await service.getPremiumDecisions("guild");
  assert.deepEqual(new Set(PREMIUM_FEATURES), new Set([
    EntitlementFeature.TICKET_PREMIUM,
    EntitlementFeature.WELCOME_IMAGE,
  ]));
  assert.deepEqual(calls.map(({ feature }) => feature).sort(), [...PREMIUM_FEATURES].sort());
  assert.ok(Object.values(decisions).every(({ code }) => code === EntitlementDecision.GRANTED));
});

test("GuildSettingsService reports Premium unavailable when its dependency is absent", async () => {
  const service = new GuildSettingsService({
    guildConfigResolver: { getLanguage: async () => "fr", update: async () => ({}) },
    configurationReader: async () => ({}),
  });
  const decisions = await service.getPremiumDecisions("guild");
  assert.ok(Object.values(decisions).every(({ code }) => code === EntitlementDecision.UNAVAILABLE));
});
