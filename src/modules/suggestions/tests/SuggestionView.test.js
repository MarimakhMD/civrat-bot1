"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { suggestionView } = require("../interactions/suggestionViews");
const { SuggestionComponentId: Id } = require("../configuration/suggestionConstants");

test("suggestion view disabled", () => {
  const t = (k) => k;
  const view = suggestionView({ t, config: { suggestions_enabled: false } });
  assert.equal(view.title, "suggestion.title");
  assert.equal(view.content, "suggestion.disabled");
  const ids = view.components.map((c) => c.customId);
  assert.ok(ids.includes(Id.TOGGLE));
  assert.ok(ids.includes(Id.CHANNEL));
  assert.ok(ids.includes(Id.BACK));
});

test("suggestion view enabled", () => {
  const t = (k) => k;
  const view = suggestionView({ t, config: { suggestions_enabled: true } });
  assert.equal(view.content, "suggestion.enabled");
  const toggle = view.components.find((c) => c.customId === Id.TOGGLE);
  assert.equal(toggle.style, "success");
});
