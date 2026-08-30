"use strict";

// Phase 3.1 — bloqueurs Discord réels :
//  1. limites de composants (max 5 lignes d'action, 5 boutons/ligne) : chaque
//     vue /settings, y compris les sous-vues Welcome & Goodbye, doit passer par
//     le transport réel sans dépasser les limites ;
//  2. modales Goodbye : les valeurs saisies (modalValues) doivent atteindre la
//     persistance de configuration via le pont fields appliqué aux routes.
// Hors ligne : interactions factices, aucun accès Discord/Supabase/MongoDB.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createGuildSettingsRuntime } = require("../../src/runtime/createGuildSettingsRuntime");
const { MAX_ACTION_ROWS, MAX_BUTTONS_PER_ROW } = require("../../src/adapters/discord/DiscordResponseTransport");
const { WelcomeGoodbyeComponentId: Id, WelcomeGoodbyeConfigKey: Key } = require("../../src/modules/welcome-goodbye/configuration/welcomeGoodbyeConstants");
const { openGoodbyeEmbedColorModal } = require("../../src/modules/welcome-goodbye/interactions/goodbyeEmbedColorModal");
const { openWelcomeEmbedColorModal } = require("../../src/modules/welcome-goodbye/interactions/welcomeEmbedColorModal");
const { SETTINGS_CATALOG } = require("../../src/modules/guild-settings/configuration/settingsCatalog");
const { SettingsComponentId } = require("../../src/modules/guild-settings/interactions/settingsComponents");

const SECTION_IDS = [
  "civrat:v1:welcome-goodbye:section",
  "civrat:v1:autorole:section",
  "civrat:v1:automod:section",
  "civrat:v1:security:section",
  "civrat:v1:tempvoice:section",
  "civrat:v1:giveaway:section",
  "civrat:v1:suggestion:section",
  "civrat:v1:tickets:panel",
  "civrat:v1:captcha:section",
  "civrat:v1:logs:section",
  "civrat:v1:analytics:section",
  "civrat:v1:xp:section",
  "civrat:v1:invites:section",
];

function legacyConfig(updates) {
  const config = { language: "fr" };
  return {
    getGuildConfig: async () => config,
    getGuildConfigState: async () => ({ config, available: true, found: true, source: "database" }),
    updateGuildConfig: async (_id, update) => { updates.push(update); Object.assign(config, update); return config; },
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
  });
}

function command(name, captured) { const interaction = base({}, captured); interaction.isChatInputCommand = () => true; interaction.commandName = name; return interaction; }
function button(customId, captured) { const interaction = base({}, captured); interaction.isButton = () => true; interaction.customId = customId; return interaction; }
function select(customId, values, captured) { const interaction = base({}, captured); interaction.isStringSelectMenu = () => true; interaction.customId = customId; interaction.values = values; return interaction; }
function modal(customId, fields, captured) {
  const interaction = base({}, captured);
  interaction.isModalSubmit = () => true;
  interaction.customId = customId;
  interaction.fields = { fields: Object.entries(fields).map(([id, value]) => ({ customId: id, value })) };
  return interaction;
}

function rendered(captured) { return captured.update || captured.reply || null; }

function payloadContains(payload, customId) {
  return payload && JSON.stringify(payload.components || []).includes(`"custom_id":"${customId}"`);
}

function assertDiscordLimits(payload, label) {
  assert.ok(payload, `${label} produced no payload`);
  const rows = payload.components || [];
  assert.ok(rows.length <= MAX_ACTION_ROWS, `${label} renders ${rows.length} rows — above the ${MAX_ACTION_ROWS} Discord limit`);
  for (const row of rows) {
    assert.ok(row.components.length <= MAX_BUTTONS_PER_ROW, `${label} has a row with ${row.components.length} components — above the ${MAX_BUTTONS_PER_ROW} Discord limit`);
  }
}

test("the /settings home stays within Discord component limits", async () => {
  const runtime = createGuildSettingsRuntime({ legacyConfigService: legacyConfig([]) });
  const captured = {};
  assert.equal(await runtime.tryHandle(command("settings", captured)), true);
  assertDiscordLimits(captured.reply, "settings home");
});

test("every settings category view stays within Discord component limits", async () => {
  const runtime = createGuildSettingsRuntime({ legacyConfigService: legacyConfig([]) });
  for (const category of SETTINGS_CATALOG) {
    const captured = {};
    assert.equal(
      await runtime.tryHandle(select(SettingsComponentId.CATEGORY, [category.id], captured)),
      true,
      `category ${category.id} not routed`,
    );
    assertDiscordLimits(captured.update, `settings category ${category.id}`);
  }
});

test("every settings section view stays within Discord component limits", async () => {
  const runtime = createGuildSettingsRuntime({ legacyConfigService: legacyConfig([]) });
  for (const sectionId of SECTION_IDS) {
    const captured = {};
    assert.equal(await runtime.tryHandle(button(sectionId, captured)), true, `section ${sectionId} not routed`);
    assertDiscordLimits(rendered(captured), `section ${sectionId}`);
  }
});

test("Welcome & Goodbye entry view exposes the two sub-views and the home back control", async () => {
  const runtime = createGuildSettingsRuntime({ legacyConfigService: legacyConfig([]) });
  const captured = {};
  assert.equal(await runtime.tryHandle(button(Id.SECTION, captured)), true);
  assertDiscordLimits(rendered(captured), "welcome-goodbye entry view");
  for (const id of [Id.OPEN_WELCOME, Id.OPEN_GOODBYE, Id.BACK]) {
    assert.ok(payloadContains(rendered(captured), id), `entry view is missing ${id}`);
  }
});

test("welcome sub-view keeps every Welcome control, stays within limits and returns to the entry view", async () => {
  const runtime = createGuildSettingsRuntime({ legacyConfigService: legacyConfig([]) });
  const captured = {};
  assert.equal(await runtime.tryHandle(button(Id.OPEN_WELCOME, captured)), true);
  assertDiscordLimits(rendered(captured), "welcome sub-view");
  for (const id of [Id.TOGGLE_WELCOME, Id.WELCOME_CHANNEL, Id.WELCOME_MESSAGE, Id.TOGGLE_WELCOME_EMBED, Id.WELCOME_EMBED_COLOR, Id.PREVIEW_WELCOME_EMBED, Id.TOGGLE_WELCOME_DM, Id.WELCOME_DM_MESSAGE, Id.TEST_WELCOME_DM, Id.PREVIEW_WELCOME_IMAGE, Id.TEMPLATE_SELECT, Id.TEST_WELCOME, Id.SECTION]) {
    assert.ok(payloadContains(rendered(captured), id), `welcome sub-view is missing ${id}`);
  }
  const back = {};
  assert.equal(await runtime.tryHandle(button(Id.SECTION, back)), true);
  assert.ok(payloadContains(rendered(back), Id.OPEN_WELCOME), "back from sub-view must render the entry view");
});

test("goodbye sub-view keeps every Goodbye control, stays within limits and returns to the entry view", async () => {
  const runtime = createGuildSettingsRuntime({ legacyConfigService: legacyConfig([]) });
  const captured = {};
  assert.equal(await runtime.tryHandle(button(Id.OPEN_GOODBYE, captured)), true);
  assertDiscordLimits(rendered(captured), "goodbye sub-view");
  for (const id of [Id.TOGGLE_GOODBYE, Id.GOODBYE_CHANNEL_SELECT, Id.SAME_CHANNEL, Id.GOODBYE_MESSAGE, Id.TOGGLE_GOODBYE_EMBED, Id.GOODBYE_EMBED_COLOR, Id.PREVIEW_GOODBYE_EMBED, Id.PREVIEW_GOODBYE, Id.TEST_GOODBYE, Id.SECTION]) {
    assert.ok(payloadContains(rendered(captured), id), `goodbye sub-view is missing ${id}`);
  }
  const back = {};
  assert.equal(await runtime.tryHandle(button(Id.SECTION, back)), true);
  assert.ok(payloadContains(rendered(back), Id.OPEN_GOODBYE), "back from sub-view must render the entry view");
});

test("welcome actions refresh the welcome sub-view (not the former combined view)", async () => {
  const runtime = createGuildSettingsRuntime({ legacyConfigService: legacyConfig([]) });
  const captured = {};
  assert.equal(await runtime.tryHandle(button(Id.TOGGLE_WELCOME, captured)), true);
  assertDiscordLimits(rendered(captured), "welcome sub-view after toggle");
  assert.ok(payloadContains(rendered(captured), Id.TEMPLATE_SELECT), "welcome context lost the template select");
  assert.ok(!payloadContains(rendered(captured), Id.TOGGLE_GOODBYE), "welcome sub-view must not contain Goodbye controls");
});

test("goodbye message modal persists the submitted message through the modalValues bridge", async () => {
  const updates = [];
  const runtime = createGuildSettingsRuntime({ legacyConfigService: legacyConfig(updates) });
  const captured = {};
  const handled = await runtime.tryHandle(modal(Id.GOODBYE_MESSAGE, { message: "Au revoir {user} !" }, captured));
  assert.equal(handled, true, "goodbye message modal route not handled");
  const persisted = updates.find((update) => Key.GOODBYE_MESSAGE in update);
  assert.ok(persisted, "no goodbye_message update reached the persistence layer");
  assert.equal(persisted[Key.GOODBYE_MESSAGE], "Au revoir {user} !");
  assertDiscordLimits(rendered(captured), "goodbye sub-view after message save");
});

test("goodbye embed color modal persists the submitted color through the modalValues bridge", async () => {
  const updates = [];
  const runtime = createGuildSettingsRuntime({ legacyConfigService: legacyConfig(updates) });
  const captured = {};
  const handled = await runtime.tryHandle(modal(Id.GOODBYE_EMBED_COLOR, { color: "#ff0000" }, captured));
  assert.equal(handled, true, "goodbye color modal route not handled");
  const persisted = updates.find((update) => Key.GOODBYE_COLOR in update);
  assert.ok(persisted, "no goodbye_embed_color update reached the persistence layer");
  assert.equal(persisted[Key.GOODBYE_COLOR], "#ff0000");
});

test("goodbye embed color modal prefills the Goodbye color, not the Welcome one", async () => {
  let modal = null;
  await openGoodbyeEmbedColorModal({ t: (key) => key, config: { goodbye_embed_color: "#123456", welcome_embed_color: "#abcdef" }, envelope: { transport: { showModal: async (built) => { modal = built; } } } });
  assert.equal(modal.fields[0].value, "#123456");
});

test("welcome embed color modal still prefills the Welcome color (regression)", async () => {
  let modal = null;
  await openWelcomeEmbedColorModal({ t: (key) => key, config: { goodbye_embed_color: "#123456", welcome_embed_color: "#abcdef" }, envelope: { transport: { showModal: async (built) => { modal = built; } } } });
  assert.equal(modal.fields[0].value, "#abcdef");
});
