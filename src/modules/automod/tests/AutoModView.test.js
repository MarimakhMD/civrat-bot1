"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { autoModView } = require("../interactions/automodViews");
const { AutoModComponentId: Id } = require("../configuration/automodConstants");

test("view reflects disabled state and exposes the configured components", () => {
  const t = (key) => key;
  const view = autoModView({ t, config: { automod_enabled: false } });
  assert.equal(view.title, "automod.title");
  assert.equal(view.content, "automod.disabled");
  const customIds = view.components.map((component) => component.customId).filter(Boolean);
  // SECTION is the settings-panel trigger that opens this view; it is not part of the view itself.
  assert.ok(!customIds.includes(Id.SECTION));
  assert.ok(customIds.includes(Id.TOGGLE));
  assert.ok(customIds.includes(Id.DELETE_MESSAGE));
  assert.ok(customIds.includes(Id.THRESHOLDS_OPEN));
  assert.ok(customIds.includes(Id.BAD_WORDS_OPEN));
  assert.ok(customIds.includes(Id.ENFORCE_SELECT));
  assert.ok(customIds.includes(Id.BACK));
  assert.ok(customIds.some((id) => id.startsWith(`${Id.TOGGLE_PREFIX}:`)));
});

test("view marks enabled rules with the success style", () => {
  const t = (key) => key;
  const view = autoModView({ t, config: { automod_enabled: true, automod_anti_links: true } });
  assert.equal(view.content, "automod.enabled");
  const links = view.components.find((c) => c.customId === `${Id.TOGGLE_PREFIX}:antiLinks`);
  assert.equal(links.style, "success");
  const caps = view.components.find((c) => c.customId === `${Id.TOGGLE_PREFIX}:antiCaps`);
  assert.equal(caps.style, "secondary");
});
