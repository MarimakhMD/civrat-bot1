"use strict";

// Phase 10.2 — intégration runtime de la sous-vue « Personnalisation Premium »
// via la vraie composition /settings. Hors ligne : pas de Supabase configuré —
// le resolver est donc fail-closed et la vue doit être VERROUILLÉE, ce qui
// prouve l'absence de fuite Premium et l'absence de contrôle utilisable.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createGuildSettingsRuntime } = require("../../src/runtime/createGuildSettingsRuntime");
const { MAX_ACTION_ROWS, MAX_BUTTONS_PER_ROW } = require("../../src/adapters/discord/DiscordResponseTransport");
const { TicketComponentId: Id } = require("../../src/modules/tickets/configuration/ticketConstants");

function legacyConfig() {
  return {
    getGuildConfig: async () => ({ language: "fr" }),
    updateGuildConfig: async (_id, update) => update,
    invalidateCache: async () => {},
  };
}

function button(customId, captured) {
  return {
    isChatInputCommand: () => false,
    isAutocomplete: () => false,
    isButton: () => true,
    isStringSelectMenu: () => false,
    isChannelSelectMenu: () => false,
    isRoleSelectMenu: () => false,
    isModalSubmit: () => false,
    guildId: "g",
    user: { id: "u" },
    member: { id: "u", permissions: { has: () => true } },
    customId,
    reply: async (payload) => { captured.reply = payload; },
    followUp: async () => {},
    update: async (payload) => { captured.update = payload; },
    showModal: async (modal) => { captured.modal = modal; },
  };
}

function rendered(captured) { return captured.update || captured.reply || null; }

function contains(payload, customId) {
  return JSON.stringify(payload?.components || []).includes(`"custom_id":"${customId}"`);
}

function assertLimits(payload, label) {
  assert.ok(payload, `${label} produced no payload`);
  const rows = payload.components || [];
  assert.ok(rows.length <= MAX_ACTION_ROWS, `${label} renders ${rows.length} rows`);
  for (const row of rows) assert.ok(row.components.length <= MAX_BUTTONS_PER_ROW, `${label} has an oversized row`);
}

test("tickets settings view exposes the Premium entry and keeps every Free control within limits", async () => {
  const runtime = createGuildSettingsRuntime({ legacyConfigService: legacyConfig() });
  const captured = {};
  assert.equal(await runtime.tryHandle(button(Id.PANEL, captured)), true);
  const payload = rendered(captured);
  assertLimits(payload, "tickets section");
  for (const id of [Id.TOGGLE, Id.CATEGORY, Id.SUPPORT_ROLE, Id.PREVIEW, Id.BACK]) {
    assert.ok(contains(payload, id), `tickets section lost the Free control ${id}`);
  }
  assert.ok(contains(payload, Id.PREMIUM_SECTION), "tickets section misses the Premium entry");
});

test("offline (fail-closed resolver), the Premium sub-view is locked and offers no usable control", async () => {
  const runtime = createGuildSettingsRuntime({ legacyConfigService: legacyConfig() });
  const captured = {};
  assert.equal(await runtime.tryHandle(button(Id.PREMIUM_SECTION, captured)), true);
  const payload = rendered(captured);
  assertLimits(payload, "locked premium view");
  assert.ok(contains(payload, Id.PANEL), "locked view must offer Back to the Tickets section");
  assert.equal(contains(payload, Id.PREMIUM_EDIT), false);
  assert.equal(contains(payload, Id.PREMIUM_RESET), false);
  assert.equal(contains(payload, Id.PREMIUM_PREVIEW), false);
  assert.ok((payload.content || "").includes("Premium"));
});

test("premium edit, preview and reset routes are all fail-closed offline (no modal, no write)", async () => {
  const runtime = createGuildSettingsRuntime({ legacyConfigService: legacyConfig() });
  for (const id of [Id.PREMIUM_EDIT, Id.PREMIUM_PREVIEW, Id.PREMIUM_RESET]) {
    const captured = {};
    assert.equal(await runtime.tryHandle(button(id, captured)), true, `${id} not routed`);
    assert.equal(captured.modal, undefined, `${id} must not open a modal when locked`);
    const payload = rendered(captured);
    assert.ok(payload, `${id} must render the locked view`);
    assert.ok(contains(payload, Id.PANEL), `${id} locked view must offer Back`);
    assert.equal(contains(payload, Id.PREMIUM_EDIT), false, `${id} locked view must not expose edit`);
    assert.equal(contains(payload, Id.PREMIUM_RESET), false, `${id} locked view must not expose reset`);
  }
});
