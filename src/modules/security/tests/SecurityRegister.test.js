"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { InteractionRegistry } = require("../../../core/interactions");
const { PermissionName } = require("../../../core/permissions");
const { registerSecurity } = require("../register");
const { SecurityComponentId: Id, SecurityConfigKey: Key } = require("../configuration/securityConstants");
// P9 — e2e obligatoire : le plumbing routeur RÉEL (adapter → router →
// context → handlers → persistance legacy), hors ligne, sans Discord/Supabase.
const { createGuildSettingsRuntime } = require("../../../runtime/createGuildSettingsRuntime");

function fakeService() {
  return { read: async () => ({}), update: async () => ({}) };
}

test("Security registers ManageGuild-gated routes and section", () => {
  const registry = new InteractionRegistry();
  registerSecurity({ registry, service: fakeService(), settingsHome: async () => {} });

  for (const customId of [Id.SECTION, Id.TOGGLE, Id.ANTI_RAID, Id.ANTI_BOT, Id.ANTI_NUKE, Id.WHITELIST_OPEN, Id.BACK]) {
    const route = registry.find({ kind: "button", customId });
    assert.ok(route, `expected route for ${customId}`);
    assert.deepEqual(route.permissions.allOf, [PermissionName.MANAGE_GUILD]);
  }

  // La modale est enregistrée via prefix matcher : le customId exact matche.
  const modalRoute = registry.find({ kind: "modal", customId: Id.WHITELIST_MODAL });
  assert.ok(modalRoute, "expected whitelist modal route (prefix matcher)");
  assert.deepEqual(modalRoute.permissions.allOf, [PermissionName.MANAGE_GUILD]);
});

// ── Harnais e2e (miroir du pattern settings-views-discord-limits) ─────────

function legacyConfig(updates, initial = {}) {
  const config = { language: "fr", ...initial };
  return {
    getGuildConfig: async () => config,
    getGuildConfigState: async () => ({ config, available: true, found: true, source: "database" }),
    updateGuildConfig: async (_id, update) => {
      updates.push(update);
      Object.assign(config, update);
      return config;
    },
    invalidateCache: async () => {},
  };
}

function base(interaction, captured) {
  return Object.assign(interaction, {
    isChatInputCommand: () => false,
    isAutocomplete: () => false,
    isButton: () => false,
    isStringSelectMenu: () => false,
    isChannelSelectMenu: () => false,
    isRoleSelectMenu: () => false,
    isModalSubmit: () => false,
    guildId: "g",
    channelId: "channel",
    locale: "fr",
    user: { id: "u" },
    member: { id: "u", permissions: { has: () => true }, roles: { cache: { has: () => false } } },
    reply: async (payload) => { captured.reply = payload; },
    followUp: async () => {},
    update: async (payload) => { captured.update = payload; },
    showModal: async (modal) => { captured.showModal = modal; },
  });
}

function actor(interaction, userId) {
  interaction.user = { id: userId };
  interaction.member = { id: userId, permissions: { has: () => true }, roles: { cache: { has: () => false } } };
  return interaction;
}

function button(customId, captured, userId = "u") {
  const interaction = base({}, captured);
  interaction.isButton = () => true;
  interaction.customId = customId;
  return actor(interaction, userId);
}

function modal(customId, fields, captured, userId = "u") {
  const interaction = base({}, captured);
  interaction.isModalSubmit = () => true;
  interaction.customId = customId;
  interaction.fields = { fields: Object.entries(fields).map(([id, value]) => ({ customId: id, value })) };
  return actor(interaction, userId);
}

// ── Décision 9 — e2e OBLIGATOIRE ───────────────────────────────────────────

test("e2e A — whitelist-open button really opens the modal through the router", async () => {
  const updates = [];
  const runtime = createGuildSettingsRuntime({
    legacyConfigService: legacyConfig(updates, { security_whitelist: ["111111111111111", "222222222222222"] }),
  });
  const captured = {};
  assert.equal(await runtime.tryHandle(button(Id.WHITELIST_OPEN, captured, "u-open")), true);
  assert.ok(captured.showModal, "showModal was never called — the whitelist modal did not open");
  const data = captured.showModal.toJSON();
  assert.equal(data.custom_id, Id.WHITELIST_MODAL);
  assert.ok(data.title && data.title.length > 0, "modal title missing");
  const field = data.components[0].components[0];
  assert.equal(field.custom_id, "whitelist");
  assert.equal(field.required, false);
  // préremplissage réel depuis la persistance (normalisé par la lecture P9)
  assert.equal(field.value, "111111111111111, 222222222222222");
  // P9 — maxLength 4000 transmis au VRAI TextInput (payload Discord)
  assert.equal(field.max_length, 4000);
  // ouverture en lecture seule : aucune écriture
  assert.equal(updates.length, 0, "opening the modal must not write anything");
});

test("e2e B — modal submission persists the real typed values through the router", async () => {
  const updates = [];
  const runtime = createGuildSettingsRuntime({ legacyConfigService: legacyConfig(updates) });
  const captured = {};
  const handled = await runtime.tryHandle(modal(
    Id.WHITELIST_MODAL,
    { whitelist: "111111111111111, 222222222222222 , junk, 111111111111111" },
    captured,
    "u-submit",
  ));
  assert.equal(handled, true, "whitelist modal submission not routed");
  const persisted = updates.find((update) => Key.WHITELIST in update);
  assert.ok(persisted, "no security_whitelist update reached the persistence layer");
  // les vraies valeurs saisies arrivent dans submitWhitelist ; junk supprimé,
  // doublons dédupliqués, ordre de première apparition conservé — jamais []
  assert.deepEqual(persisted[Key.WHITELIST], ["111111111111111", "222222222222222"]);
  assert.ok(captured.update || captured.reply, "no acknowledgement payload after submission");

  // round-trip : la liste persistée ressort à la réouverture de la modale
  const reopened = {};
  assert.equal(await runtime.tryHandle(button(Id.WHITELIST_OPEN, reopened, "u-reopen")), true);
  assert.ok(reopened.showModal, "modal did not reopen after submission");
  assert.equal(reopened.showModal.toJSON().components[0].components[0].value, "111111111111111, 222222222222222");
});

test("e2e C — a submission never wipes the whitelist when valid entries are provided", async () => {
  const updates = [];
  const runtime = createGuildSettingsRuntime({
    legacyConfigService: legacyConfig(updates, { security_whitelist: ["111111111111111"] }),
  });
  const captured = {};
  assert.equal(
    await runtime.tryHandle(modal(Id.WHITELIST_MODAL, { whitelist: "111111111111111, junk" }, captured, "u-keep")),
    true,
    "whitelist modal submission not routed",
  );
  const persisted = updates.find((update) => Key.WHITELIST in update);
  assert.ok(persisted, "no security_whitelist update reached the persistence layer");
  // régression du bug P9 : l'écriture ne doit PLUS être un [] aveugle
  assert.notDeepEqual(persisted[Key.WHITELIST], [], "a submission with valid entries must not empty the whitelist");
  assert.deepEqual(persisted[Key.WHITELIST], ["111111111111111"]);
});
