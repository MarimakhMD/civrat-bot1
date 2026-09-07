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

function base(customId, captured) {
  return {
    isChatInputCommand: () => false,
    isAutocomplete: () => false,
    isButton: () => false,
    isStringSelectMenu: () => false,
    isChannelSelectMenu: () => false,
    isRoleSelectMenu: () => false,
    isModalSubmit: () => false,
    guildId: "g",
    user: { id: "u" },
    member: { id: "u", permissions: { has: () => true } },
    customId,
    values: [],
    reply: async (payload) => { captured.reply = payload; },
    followUp: async () => {},
    update: async (payload) => { captured.update = payload; },
    showModal: async (modal) => { captured.modal = modal; },
  };
}

function button(customId, captured) {
  const interaction = base(customId, captured);
  interaction.isButton = () => true;
  return interaction;
}

function channelSelect(customId, values, captured) {
  const interaction = base(customId, captured);
  interaction.isChannelSelectMenu = () => true;
  interaction.values = values;
  return interaction;
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
  // M8 (D-A) — l'entrée « Aperçu » a cédé sa place à l'entrée « Panels » : la
  // section Tickets occupait déjà les 5 lignes d'action autorisées par Discord.
  for (const id of [Id.TOGGLE, Id.CATEGORY, Id.SUPPORT_ROLE, Id.LOG_CHANNEL, Id.PANELS_SECTION, Id.BACK]) {
    assert.ok(contains(payload, id), `tickets section lost the Free control ${id}`);
  }
  assert.ok(!contains(payload, Id.PREVIEW), "tickets section must no longer expose the preview entry");
  assert.ok(contains(payload, Id.PREMIUM_SECTION), "tickets section misses the Premium entry");
});

test("offline (fail-closed resolver), the Premium sub-view is locked and offers no usable control", async () => {
  const runtime = createGuildSettingsRuntime({ legacyConfigService: legacyConfig() });
  const captured = {};
  assert.equal(await runtime.tryHandle(button(Id.PREMIUM_SECTION, captured)), true);
  const payload = rendered(captured);
  assertLimits(payload, "locked premium view");
  assert.ok(contains(payload, Id.PANEL), "locked view must offer Back to the Tickets section");
  for (const id of [Id.PREMIUM_EDIT, Id.PREMIUM_RESET, Id.PREMIUM_PREVIEW, Id.PREMIUM_EDIT_WELCOME, Id.PREMIUM_PREVIEW_WELCOME, Id.PREMIUM_TRANSCRIPT, Id.PREMIUM_EDIT_FORMAT]) {
    assert.equal(contains(payload, id), false, `locked view must not expose ${id}`);
  }
  assert.ok((payload.content || "").includes("Premium"));
});

test("premium edit, preview and reset routes are all fail-closed offline (no modal, no write)", async () => {
  const runtime = createGuildSettingsRuntime({ legacyConfigService: legacyConfig() });
  for (const id of [Id.PREMIUM_EDIT, Id.PREMIUM_PREVIEW, Id.PREMIUM_RESET, Id.PREMIUM_EDIT_WELCOME, Id.PREMIUM_PREVIEW_WELCOME, Id.PREMIUM_EDIT_FORMAT]) {
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

test("the premium transcript channel select is fail-closed offline (no write)", async () => {
  const updates = [];
  const runtime = createGuildSettingsRuntime({
    legacyConfigService: {
      getGuildConfig: async () => ({ language: "fr" }),
      updateGuildConfig: async (_id, update) => { updates.push(update); return update; },
      invalidateCache: async () => {},
    },
  });
  const captured = {};
  assert.equal(await runtime.tryHandle(channelSelect(Id.PREMIUM_TRANSCRIPT, ["123456789012345678"], captured)), true);
  assert.equal(updates.length, 0, "locked transcript select must not write Premium config offline");
  assert.ok(rendered(captured), "locked transcript select must render the locked view");
});
