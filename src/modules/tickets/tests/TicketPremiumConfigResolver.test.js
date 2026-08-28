"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EntitlementDecision, EntitlementFeature, EntitlementService } = require("../../../core/entitlements");
const { TicketPremiumConfigResolver } = require("../services/TicketPremiumConfigResolver");
const { TicketPremiumDefaults } = require("../configuration/ticketPremiumDefaults");
const { TicketPremiumConfigKey: Key } = require("../configuration/ticketPremiumConstants");

const premiumConfig = {
  [Key.PANEL_TITLE]: "Support Premium",
  [Key.PANEL_DESCRIPTION]: "Décrivez votre problème.",
  [Key.PANEL_COLOR]: "#8061ef",
  [Key.PANEL_IMAGE_URL]: "https://cdn.example.com/panel.png",
  [Key.CREATE_BUTTON_LABEL]: "📩 Contacter le staff",
  [Key.NAME_FORMAT]: "ticket-{number}",
  [Key.WELCOME_MESSAGE]: "Bonjour {mention} !",
  [Key.TRANSCRIPT_CHANNEL_ID]: "123456789012345678",
};

// Le vrai EntitlementService est utilisé (seul le repository est simulé) afin
// d'exercer la logique réelle status === "active" + expiration ends_at.
function makeResolver({ record = null, repositoryError = null, calls = [] } = {}) {
  const repository = {
    findFeature: async (guildId, feature) => {
      calls.push({ guildId, feature });
      if (repositoryError) throw repositoryError;
      return record;
    },
  };
  return new TicketPremiumConfigResolver({ entitlementService: new EntitlementService({ repository }) });
}

const activeRecord = { status: "active", ends_at: null };

test("active entitlement resolves the stored Premium overrides", async () => {
  const resolver = makeResolver({ record: activeRecord });
  const resolved = await resolver.resolve({ guildId: "guild", config: premiumConfig });
  assert.deepEqual(resolved, premiumConfig);
});

test("resolution checks exactly the TICKET_PREMIUM feature for the right guild", async () => {
  const calls = [];
  const resolver = makeResolver({ record: activeRecord, calls });
  await resolver.resolve({ guildId: "guild-42", config: {} });
  assert.deepEqual(calls, [{ guildId: "guild-42", feature: EntitlementFeature.TICKET_PREMIUM }]);
});

test("checkAccess preserves granted, required, and unavailable decisions", async () => {
  assert.equal((await makeResolver({ record: activeRecord }).checkAccess("guild")).code, EntitlementDecision.GRANTED);
  assert.equal((await makeResolver({ record: null }).checkAccess("guild")).code, EntitlementDecision.PREMIUM_REQUIRED);
  assert.equal(
    (await makeResolver({ repositoryError: new Error("offline") }).checkAccess("guild")).code,
    EntitlementDecision.UNAVAILABLE,
  );
  assert.equal((await new TicketPremiumConfigResolver({}).checkAccess("guild")).code, EntitlementDecision.UNAVAILABLE);
});

test("inactive entitlement falls back to Free and never leaks stored Premium values", async () => {
  for (const record of [null, { status: "revoked", ends_at: null }, { status: "pending", ends_at: null }]) {
    const resolver = makeResolver({ record });
    const resolved = await resolver.resolve({ guildId: "guild", config: premiumConfig });
    assert.deepEqual(resolved, TicketPremiumDefaults);
    for (const value of Object.values(resolved)) assert.equal(value, null);
  }
});

test("expired entitlement falls back to Free; future ends_at stays Premium", async () => {
  const expired = makeResolver({ record: { status: "active", ends_at: "2020-01-01T00:00:00.000Z" } });
  assert.deepEqual(await expired.resolve({ guildId: "guild", config: premiumConfig }), TicketPremiumDefaults);
  const future = makeResolver({ record: { status: "active", ends_at: "2999-01-01T00:00:00.000Z" } });
  assert.deepEqual(await future.resolve({ guildId: "guild", config: premiumConfig }), premiumConfig);
});

test("entitlement check failure is fail-closed: Free defaults, no throw", async () => {
  const resolver = makeResolver({ record: activeRecord, repositoryError: new Error("supabase down") });
  const resolved = await resolver.resolve({ guildId: "guild", config: premiumConfig });
  assert.deepEqual(resolved, TicketPremiumDefaults);
});

test("missing entitlement service or guild id resolves pure Free", async () => {
  const noService = new TicketPremiumConfigResolver({});
  assert.deepEqual(await noService.resolve({ guildId: "guild", config: premiumConfig }), TicketPremiumDefaults);
  const resolver = makeResolver({ record: activeRecord });
  assert.deepEqual(await resolver.resolve({ guildId: null, config: premiumConfig }), TicketPremiumDefaults);
});

test("invalid stored values fall back per key while valid ones stay Premium", async () => {
  const resolver = makeResolver({ record: activeRecord });
  const resolved = await resolver.resolve({
    guildId: "guild",
    config: {
      ...premiumConfig,
      [Key.PANEL_COLOR]: "blue", // invalide → fallback Free
      [Key.CREATE_BUTTON_LABEL]: "x".repeat(81), // invalide → fallback Free
      [Key.NAME_FORMAT]: "support", // sans placeholder d'unicité → fallback Free
    },
  });
  assert.equal(resolved[Key.PANEL_TITLE], premiumConfig[Key.PANEL_TITLE]);
  assert.equal(resolved[Key.WELCOME_MESSAGE], premiumConfig[Key.WELCOME_MESSAGE]);
  assert.equal(resolved[Key.TRANSCRIPT_CHANNEL_ID], premiumConfig[Key.TRANSCRIPT_CHANNEL_ID]);
  assert.equal(resolved[Key.PANEL_COLOR], null);
  assert.equal(resolved[Key.CREATE_BUTTON_LABEL], null);
  assert.equal(resolved[Key.NAME_FORMAT], null);
});

test("absent keys fall back to Free defaults and unknown keys are never copied", async () => {
  const resolver = makeResolver({ record: activeRecord });
  const resolved = await resolver.resolve({
    guildId: "guild",
    config: { [Key.PANEL_TITLE]: "Seul ce titre est posé", ticket_unknown: "x", tickets_enabled: true },
  });
  assert.equal(resolved[Key.PANEL_TITLE], "Seul ce titre est posé");
  assert.equal(resolved[Key.PANEL_DESCRIPTION], null);
  assert.equal("ticket_unknown" in resolved, false);
  assert.equal("tickets_enabled" in resolved, false);
  assert.deepEqual(Object.keys(resolved), Object.keys(TicketPremiumDefaults));
});

test("resolve never mutates the input config", async () => {
  const resolver = makeResolver({ record: activeRecord });
  const config = { ...premiumConfig };
  const snapshot = JSON.stringify(config);
  await resolver.resolve({ guildId: "guild", config });
  assert.equal(JSON.stringify(config), snapshot);
});

test("active entitlement over an empty config resolves pure Free defaults", async () => {
  const resolver = makeResolver({ record: activeRecord });
  assert.deepEqual(await resolver.resolve({ guildId: "guild", config: {} }), TicketPremiumDefaults);
  assert.deepEqual(await resolver.resolve({ guildId: "guild" }), TicketPremiumDefaults);
});
