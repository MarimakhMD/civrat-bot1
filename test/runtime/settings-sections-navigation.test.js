"use strict";

// Phase 1 — navigation /settings : toutes les sections doivent être accessibles
// depuis l'accueil et revenir à l'accueil via BACK, sans régression sur les
// sections déjà présentes. Hors ligne : interactions factices, aucun accès
// Discord/Supabase/MongoDB.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createGuildSettingsRuntime } = require("../../src/runtime/createGuildSettingsRuntime");

const LANGUAGE_BUTTON_ID = "civrat:v1:guild-settings:language";

const EXPECTED_HOME_SECTIONS = [
  "civrat:v1:welcome-goodbye:section",
  "civrat:v1:autorole:section",
  "civrat:v1:automod:section",
  "civrat:v1:security:section",
  "civrat:v1:tempvoice:section",
  "civrat:v1:giveaway:section",
  "civrat:v1:suggestion:section",
  // Sections rendues accessibles en Phase 1 :
  "civrat:v1:tickets:panel",
  "civrat:v1:captcha:section",
  "civrat:v1:logs:section",
  "civrat:v1:analytics:section",
];

function legacyConfig() {
  return {
    getGuildConfig: async () => ({ language: "fr" }),
    updateGuildConfig: async (_id, update) => update,
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
    isModalSubmit: () => false,
    guildId: "g",
    user: { id: "u" },
    member: { id: "u", permissions: { has: () => true } },
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

function payloadContains(payload, customId) {
  return payload && JSON.stringify(payload.components || []).includes(`"custom_id":"${customId}"`);
}

test("settings home exposes every section including the Phase 1 additions", async () => {
  const runtime = createGuildSettingsRuntime({ legacyConfigService: legacyConfig() });
  const captured = {};
  const handled = await runtime.tryHandle(command("settings", captured));
  assert.equal(handled, true);
  assert.ok(captured.reply, "home rendered through reply");
  for (const customId of [LANGUAGE_BUTTON_ID, ...EXPECTED_HOME_SECTIONS]) {
    assert.ok(payloadContains(captured.reply, customId), `home panel is missing section ${customId}`);
  }
});

test("Phase 1 sections open their settings view from the home panel", async () => {
  const runtime = createGuildSettingsRuntime({ legacyConfigService: legacyConfig() });
  const cases = [
    ["civrat:v1:tickets:panel", "civrat:v1:tickets:back"],
    ["civrat:v1:captcha:section", "civrat:v1:captcha:back"],
    ["civrat:v1:logs:section", "civrat:v1:logs:home"],
    ["civrat:v1:analytics:section", "civrat:v1:analytics:back"],
  ];
  for (const [sectionId, ownComponentId] of cases) {
    const captured = {};
    const handled = await runtime.tryHandle(button(sectionId, captured));
    assert.equal(handled, true, `section ${sectionId} not routed`);
    assert.ok(payloadContains(captured.update, ownComponentId), `section ${sectionId} view missing ${ownComponentId}`);
  }
});

test("pre-existing sections still open (regression)", async () => {
  const runtime = createGuildSettingsRuntime({ legacyConfigService: legacyConfig() });
  for (const sectionId of EXPECTED_HOME_SECTIONS.slice(0, 7)) {
    const captured = {};
    const handled = await runtime.tryHandle(button(sectionId, captured));
    assert.equal(handled, true, `section ${sectionId} no longer routed`);
    assert.ok(captured.update, `section ${sectionId} did not render its view`);
  }
});

test("every section returns to the settings home through its back control", async () => {
  const runtime = createGuildSettingsRuntime({ legacyConfigService: legacyConfig() });
  const backControls = [
    "civrat:v1:tickets:back",
    "civrat:v1:captcha:back",
    "civrat:v1:analytics:back",
    "civrat:v1:logs:home",
    // Régression : retour déjà fonctionnel avant Phase 1.
    "civrat:v1:welcome-goodbye:back",
  ];
  for (const backId of backControls) {
    const captured = {};
    const handled = await runtime.tryHandle(button(backId, captured));
    assert.equal(handled, true, `back control ${backId} not routed`);
    assert.ok(
      payloadContains(captured.update, LANGUAGE_BUTTON_ID),
      `back control ${backId} did not return to the settings home`,
    );
  }
});
