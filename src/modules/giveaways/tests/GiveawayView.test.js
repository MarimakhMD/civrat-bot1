"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { giveawayView } = require("../interactions/giveawayViews");
const { GiveawayComponentId: Id } = require("../configuration/giveawayConstants");

test("giveaway view disabled", () => {
  const t = (k) => k;
  const view = giveawayView({ t, config: { giveaways_enabled: false } });
  assert.equal(view.title, "giveaway.title");
  assert.equal(view.content, "giveaway.disabled");
  const ids = view.components.map((c) => c.customId);
  assert.ok(ids.includes(Id.TOGGLE));
  assert.ok(ids.includes(Id.BACK));
});

test("giveaway view enabled", () => {
  const t = (k) => k;
  const view = giveawayView({ t, config: { giveaways_enabled: true } });
  assert.equal(view.content, "giveaway.enabled");
  const toggle = view.components.find((c) => c.customId === Id.TOGGLE);
  assert.equal(toggle.style, "success");
});

// C1 : le sélecteur de salon a été retiré — il persistait vers
// giveaway_channel_id, colonne inexistante. Le salon de publication est celui
// où /giveaway create est exécuté.
test("C1 : la vue n'expose plus de sélecteur de salon", () => {
  const view = giveawayView({ t: (k) => k, config: { giveaways_enabled: true } });
  const types = view.components.map((c) => c.type);
  assert.equal(types.includes("channel-select"), false);
  assert.equal(Id.CHANNEL, undefined, "le componentId CHANNEL doit avoir disparu");
  assert.deepEqual(view.components.map((c) => c.customId), [Id.TOGGLE, Id.BACK]);
});
