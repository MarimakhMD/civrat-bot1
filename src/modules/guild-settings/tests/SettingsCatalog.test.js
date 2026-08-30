"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EntitlementDecision, EntitlementFeature } = require("../../../core/entitlements");
const { toActionRows } = require("../../../adapters/discord/DiscordResponseTransport");
const { SETTINGS_CATALOG } = require("../configuration/settingsCatalog");
const { settingsHomeView, settingsCategoryView } = require("../interactions/settingsView");
const { SettingsComponentId } = require("../interactions/settingsComponents");

function t(key, variables = {}) {
  return `${key}${Object.keys(variables).length ? ` ${JSON.stringify(variables)}` : ""}`;
}

const configState = {
  config: {
    language: "fr",
    tickets_enabled: true,
    ticket_category_id: "category",
    ticket_support_role_id: "role",
  },
  available: true,
  found: true,
  source: "database",
};

const premiumDecisions = {
  [EntitlementFeature.TICKET_PREMIUM]: { code: EntitlementDecision.PREMIUM_REQUIRED },
  [EntitlementFeature.WELCOME_IMAGE]: { code: EntitlementDecision.UNAVAILABLE },
};

test("home renders one seven-option category selector and summaries", () => {
  const view = settingsHomeView({ t, language: "fr", configState });
  assert.equal(view.components.length, 1);
  assert.equal(view.components[0].customId, SettingsComponentId.CATEGORY);
  assert.equal(view.components[0].options.length, 7);
  assert.ok(SETTINGS_CATALOG.every((category) => view.content.includes(category.labelKey)));
  assert.ok(toActionRows(view.components).length <= 5);
});

test("category views expose exactly all 13 real feature controls", () => {
  const renderedIds = [];
  for (const category of SETTINGS_CATALOG) {
    const view = settingsCategoryView({
      t,
      language: "fr",
      categoryId: category.id,
      configState,
      premiumDecisions,
    });
    const ids = view.components.map(({ customId }) => customId);
    renderedIds.push(...ids.filter((id) => ![SettingsComponentId.HOME, SettingsComponentId.LANGUAGE].includes(id)));
    assert.ok(ids.includes(SettingsComponentId.HOME));
    assert.ok(view.content.includes("guildSettings.stateLabel"));
    assert.ok(view.content.includes("guildSettings.configurationLabel"));
    assert.ok(view.content.includes("guildSettings.permissionManageGuild"));
    assert.ok(view.content.includes("guildSettings.premiumLabel"));
    assert.ok(toActionRows(view.components).length <= 5);
  }
  assert.equal(renderedIds.length, 13);
  assert.equal(new Set(renderedIds).size, 13);
});

test("Premium capability states remain visible and distinct", () => {
  const tickets = settingsCategoryView({
    t,
    language: "fr",
    categoryId: "tickets",
    configState,
    premiumDecisions,
  });
  assert.ok(tickets.content.includes("guildSettings.premiumRequired"));
  const welcome = settingsCategoryView({
    t,
    language: "fr",
    categoryId: "welcome",
    configState,
    premiumDecisions,
  });
  assert.ok(welcome.content.includes("guildSettings.premiumUnavailable"));
});

test("configuration outage is explicit and does not hide feature controls", () => {
  const view = settingsCategoryView({
    t,
    language: "en",
    categoryId: "protection",
    configState: { config: {}, available: false, found: false, source: "unavailable" },
    premiumDecisions,
  });
  assert.ok(view.content.includes("guildSettings.configurationUnavailable"));
  assert.equal(view.components.filter(({ customId }) => customId.includes(":section")).length, 3);
});
