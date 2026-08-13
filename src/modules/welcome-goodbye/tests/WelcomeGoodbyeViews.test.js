"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { settingsView, welcomeView, goodbyeView } = require("../interactions/welcomeGoodbyeViews");
const { WelcomeGoodbyeComponentId: Id } = require("../configuration/welcomeGoodbyeConstants");
const { toActionRows, MAX_ACTION_ROWS, MAX_BUTTONS_PER_ROW } = require("../../../adapters/discord/DiscordResponseTransport");

const CONFIG = { welcome_enabled: true, welcome_embed_enabled: false, welcome_dm_enabled: false, goodbye_enabled: false, goodbye_embed_enabled: false };
const t = (key) => key;

function idsOf(view) { return view.components.map((component) => component.customId); }

test("section entry view routes to the Welcome and Goodbye sub-views within a single row", () => {
  const view = settingsView({ t, config: CONFIG });
  assert.deepEqual(idsOf(view), [Id.OPEN_WELCOME, Id.OPEN_GOODBYE, Id.BACK]);
  assert.ok(toActionRows(view.components).length <= MAX_ACTION_ROWS);
});

test("welcome sub-view keeps every existing Welcome control", () => {
  const view = welcomeView({ t, config: CONFIG });
  const ids = idsOf(view);
  for (const id of [Id.TOGGLE_WELCOME, Id.WELCOME_CHANNEL, Id.WELCOME_MESSAGE, Id.TOGGLE_WELCOME_EMBED, Id.WELCOME_EMBED_COLOR, Id.PREVIEW_WELCOME_EMBED, Id.TOGGLE_WELCOME_DM, Id.WELCOME_DM_MESSAGE, Id.TEST_WELCOME_DM, Id.PREVIEW_WELCOME_IMAGE, Id.TEST_WELCOME, Id.TEMPLATE_SELECT, Id.SECTION]) {
    assert.ok(ids.includes(id), `welcome sub-view is missing ${id}`);
  }
});

test("goodbye sub-view keeps every existing Goodbye control", () => {
  const view = goodbyeView({ t, config: CONFIG });
  const ids = idsOf(view);
  for (const id of [Id.TOGGLE_GOODBYE, Id.GOODBYE_CHANNEL_SELECT, Id.SAME_CHANNEL, Id.GOODBYE_MESSAGE, Id.TOGGLE_GOODBYE_EMBED, Id.GOODBYE_EMBED_COLOR, Id.PREVIEW_GOODBYE_EMBED, Id.PREVIEW_GOODBYE, Id.TEST_GOODBYE, Id.SECTION]) {
    assert.ok(ids.includes(id), `goodbye sub-view is missing ${id}`);
  }
});

test("sub-view split removes no feature: every legacy control appears exactly once", () => {
  const legacy = [Id.TOGGLE_WELCOME, Id.WELCOME_CHANNEL, Id.TEST_WELCOME, Id.WELCOME_MESSAGE, Id.TEMPLATE_SELECT, Id.TOGGLE_WELCOME_EMBED, Id.WELCOME_EMBED_COLOR, Id.PREVIEW_WELCOME_EMBED, Id.TOGGLE_WELCOME_DM, Id.WELCOME_DM_MESSAGE, Id.TEST_WELCOME_DM, Id.TOGGLE_GOODBYE, Id.GOODBYE_CHANNEL_SELECT, Id.SAME_CHANNEL, Id.GOODBYE_MESSAGE, Id.TOGGLE_GOODBYE_EMBED, Id.GOODBYE_EMBED_COLOR, Id.PREVIEW_GOODBYE_EMBED, Id.PREVIEW_GOODBYE, Id.TEST_GOODBYE, Id.PREVIEW_WELCOME_IMAGE, Id.BACK];
  const all = [...idsOf(settingsView({ t, config: CONFIG })), ...idsOf(welcomeView({ t, config: CONFIG })), ...idsOf(goodbyeView({ t, config: CONFIG }))];
  for (const id of legacy) {
    assert.equal(all.filter((candidate) => candidate === id).length, 1, `legacy control ${id} must appear exactly once across the split views`);
  }
});

test("each Welcome & Goodbye view fits the Discord action rows limit", () => {
  for (const view of [settingsView({ t, config: CONFIG }), welcomeView({ t, config: CONFIG }), goodbyeView({ t, config: CONFIG })]) {
    const rows = toActionRows(view.components);
    assert.ok(rows.length <= MAX_ACTION_ROWS, `view renders ${rows.length} rows, above the ${MAX_ACTION_ROWS} Discord limit`);
    for (const row of rows) {
      assert.ok(row.components.length <= MAX_BUTTONS_PER_ROW, "row contains more than 5 components");
    }
  }
});
