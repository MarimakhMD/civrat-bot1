"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { WelcomeGoodbyeService } = require("../services/WelcomeGoodbyeService");
const { selectWelcomeTemplate } = require("../interactions/selectWelcomeTemplate");
const { WelcomeGoodbyeConfigKey: Key, WelcomeGoodbyeComponentId: Id } = require("../configuration/welcomeGoodbyeConstants");
const { WelcomeGoodbyeDefaults } = require("../configuration/welcomeGoodbyeDefaults");
const { settingsView } = require("../interactions/welcomeGoodbyeViews");
const { ValidationError } = require("../../../core/errors");

function createService(initial = {}) {
  let config = { ...initial };
  return {
    service: new WelcomeGoodbyeService({
      guildConfigResolver: {
        get: async () => config,
        update: async (_guildId, updates) => { config = { ...config, ...updates }; return config; },
      },
    }),
    read: () => config,
  };
}

test("welcome template defaults to template-1", () => {
  assert.equal(WelcomeGoodbyeDefaults[Key.WELCOME_TEMPLATE], "template-1");
});

test("the three official template values are accepted and persisted", async () => {
  const { service, read } = createService();
  for (const templateId of ["template-1", "template-2", "template-3"]) {
    await service.update("guild", { [Key.WELCOME_TEMPLATE]: templateId });
    assert.equal(read()[Key.WELCOME_TEMPLATE], templateId);
  }
});

test("an unknown template value is rejected by validation", async () => {
  const { service } = createService();
  await assert.rejects(() => service.update("guild", { [Key.WELCOME_TEMPLATE]: "template-99" }), ValidationError);
  await assert.rejects(() => service.update("guild", { [Key.WELCOME_TEMPLATE]: null }), ValidationError);
});

test("template select route persists the administrator choice and refreshes the view", async () => {
  const { service, read } = createService({ welcome_template_id: "template-1" });
  let updatedView = null;
  const context = {
    guildId: "guild",
    t: (key) => key,
    settings: service,
    envelope: { values: ["template-3"], transport: { update: async (payload) => { updatedView = payload.view; } } },
  };
  const config = await selectWelcomeTemplate(context);
  assert.equal(read()[Key.WELCOME_TEMPLATE], "template-3");
  assert.equal(config[Key.WELCOME_TEMPLATE], "template-3");
  assert.ok(updatedView, "view re-rendered after selection");
  assert.ok(updatedView.components.some((component) => component.customId === Id.TEMPLATE_SELECT));
});

test("settings view exposes the three official template choices", () => {
  const view = settingsView({ t: (key) => key, config: {} });
  const select = view.components.find((component) => component.customId === Id.TEMPLATE_SELECT);
  assert.ok(select, "template select missing from the Welcome section view");
  assert.deepEqual(select.options.map((option) => option.value), ["template-1", "template-2", "template-3"]);
  assert.deepEqual(select.options.map((option) => option.label), ["welcomeGoodbye.templateBlue", "welcomeGoodbye.templateViolet", "welcomeGoodbye.templateRed"]);
});
