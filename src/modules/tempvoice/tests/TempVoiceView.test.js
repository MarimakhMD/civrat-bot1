"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { tempVoiceView } = require("../interactions/tempVoiceViews");
const { TempVoiceComponentId: Id } = require("../configuration/tempVoiceConstants");

test("tempVoice view disabled", () => {
  const t = (k) => k;
  const view = tempVoiceView({ t, config: { tempvoice_enabled: false } });
  assert.equal(view.title, "tempvoice.title");
  assert.equal(view.content, "tempvoice.disabled");
  const ids = view.components.map((c) => c.customId);
  assert.ok(ids.includes(Id.TOGGLE));
  assert.ok(ids.includes(Id.LOBBY_CHANNEL));
  assert.ok(ids.includes(Id.CATEGORY_CHANNEL));
  assert.ok(ids.includes(Id.BACK));
});

test("tempVoice view enabled", () => {
  const t = (k) => k;
  const view = tempVoiceView({ t, config: { tempvoice_enabled: true } });
  assert.equal(view.content, "tempvoice.enabled");
  const toggle = view.components.find((c) => c.customId === Id.TOGGLE);
  assert.equal(toggle.style, "success");
});
