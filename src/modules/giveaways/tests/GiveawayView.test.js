"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { giveawayView } = require("../interactions/giveawayViews");
const { GiveawayComponentId: Id } = require("../configuration/giveawayConstants");

test("giveaway view disabled", () => {
  const t = (k) => k;
  const view = giveawayView({ t, config: { giveaway_enabled: false } });
  assert.equal(view.title, "giveaway.title");
  assert.equal(view.content, "giveaway.disabled");
  const ids = view.components.map((c) => c.customId);
  assert.ok(ids.includes(Id.TOGGLE));
  assert.ok(ids.includes(Id.CHANNEL));
  assert.ok(ids.includes(Id.BACK));
});

test("giveaway view enabled", () => {
  const t = (k) => k;
  const view = giveawayView({ t, config: { giveaway_enabled: true } });
  assert.equal(view.content, "giveaway.enabled");
  const toggle = view.components.find((c) => c.customId === Id.TOGGLE);
  assert.equal(toggle.style, "success");
});
