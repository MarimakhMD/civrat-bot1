"use strict";

// Navigation /settings hors ligne : catalogue catégorisé, 13 fonctions
// accessibles, et retours vers un accueil unique. Aucun accès Discord réel.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createGuildSettingsRuntime } = require("../../src/runtime/createGuildSettingsRuntime");
const {
  SETTINGS_CATALOG,
  evaluateSettingsFeature,
} = require("../../src/modules/guild-settings/configuration/settingsCatalog");
const { SettingsComponentId } = require("../../src/modules/guild-settings/interactions/settingsComponents");

const EXPECTED_SECTIONS = [
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

function legacyConfig() {
  const config = { language: "fr" };
  return {
    getGuildConfig: async () => config,
    getGuildConfigState: async () => ({ config, available: true, found: true, source: "database" }),
    updateGuildConfig: async (_id, update) => Object.assign(config, update),
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

function command(name, captured) {
  const interaction = base({}, captured);
  interaction.isChatInputCommand = () => true;
  interaction.commandName = name;
  return interaction;
}

function button(customId, captured) {
  const interaction = base({}, captured);
  interaction.isButton = () => true;
  interaction.customId = customId;
  return interaction;
}

function select(customId, values, captured) {
  const interaction = base({}, captured);
  interaction.isStringSelectMenu = () => true;
  interaction.customId = customId;
  interaction.values = values;
  return interaction;
}

function payloadContains(payload, customId) {
  return payload && JSON.stringify(payload.components || []).includes(`"custom_id":"${customId}"`);
}

test("settings catalog contains seven non-empty categories and exactly 13 unique real sections", () => {
  assert.equal(SETTINGS_CATALOG.length, 7);
  assert.ok(SETTINGS_CATALOG.every((category) => category.features.length > 0));
  const sectionIds = SETTINGS_CATALOG.flatMap((category) => category.features.map((feature) => feature.customId));
  assert.equal(sectionIds.length, 13);
  assert.equal(new Set(sectionIds).size, 13);
  assert.deepEqual([...sectionIds].sort(), [...EXPECTED_SECTIONS].sort());
});

test("catalog state detects enabled, incomplete, and disabled configurations", () => {
  const tickets = SETTINGS_CATALOG.flatMap((category) => category.features).find(({ id }) => id === "tickets");
  assert.deepEqual(evaluateSettingsFeature(tickets, {}), { enabled: false, configured: null });
  assert.deepEqual(evaluateSettingsFeature(tickets, { tickets_enabled: true }), { enabled: true, configured: false });
  assert.deepEqual(evaluateSettingsFeature(tickets, {
    tickets_enabled: true,
    ticket_category_id: "category",
    ticket_support_role_id: "role",
  }), { enabled: true, configured: true });
});

test("settings home exposes the category selector instead of a duplicated flat grid", async () => {
  const runtime = createGuildSettingsRuntime({ legacyConfigService: legacyConfig() });
  const captured = {};
  const handled = await runtime.tryHandle(command("settings", captured));
  assert.equal(handled, true);
  assert.ok(captured.reply, "home rendered through reply");
  assert.ok(payloadContains(captured.reply, SettingsComponentId.CATEGORY));
  for (const sectionId of EXPECTED_SECTIONS) {
    assert.equal(payloadContains(captured.reply, sectionId), false, `flat home unexpectedly contains ${sectionId}`);
  }
});

test("every category exposes all and only its catalogued feature controls", async () => {
  const runtime = createGuildSettingsRuntime({ legacyConfigService: legacyConfig() });
  for (const category of SETTINGS_CATALOG) {
    const captured = {};
    const handled = await runtime.tryHandle(select(SettingsComponentId.CATEGORY, [category.id], captured));
    assert.equal(handled, true, `category ${category.id} not routed`);
    assert.ok(payloadContains(captured.update, SettingsComponentId.HOME));
    for (const feature of category.features) {
      assert.ok(payloadContains(captured.update, feature.customId), `${category.id} is missing ${feature.id}`);
    }
    if (category.includeLanguage) assert.ok(payloadContains(captured.update, SettingsComponentId.LANGUAGE));
  }
});

test("all 13 feature controls still route to their existing section", async () => {
  const runtime = createGuildSettingsRuntime({ legacyConfigService: legacyConfig() });
  for (const sectionId of EXPECTED_SECTIONS) {
    const captured = {};
    const handled = await runtime.tryHandle(button(sectionId, captured));
    assert.equal(handled, true, `section ${sectionId} no longer routed`);
    assert.ok(captured.update, `section ${sectionId} did not render its view`);
  }
});

test("category and existing section back controls return to the category home", async () => {
  const runtime = createGuildSettingsRuntime({ legacyConfigService: legacyConfig() });
  const backControls = [
    SettingsComponentId.HOME,
    "civrat:v1:tickets:back",
    "civrat:v1:captcha:back",
    "civrat:v1:analytics:back",
    "civrat:v1:logs:home",
    "civrat:v1:welcome-goodbye:back",
    "civrat:v1:automod:back",
    "civrat:v1:security:back",
    "civrat:v1:tempvoice:back",
    "civrat:v1:giveaway:back",
    "civrat:v1:suggestion:back",
    "civrat:v1:xp:back",
    "civrat:v1:invites:back",
  ];
  for (const backId of backControls) {
    const captured = {};
    const handled = await runtime.tryHandle(button(backId, captured));
    assert.equal(handled, true, `back control ${backId} not routed`);
    assert.ok(payloadContains(captured.update, SettingsComponentId.CATEGORY));
  }
});
