"use strict";

// Phase 3.1 — le transport doit empaqueter les composants de vue dans les
// limites Discord réelles : 5 lignes d'action par message, 5 boutons par ligne,
// 1 select par ligne. Avant ce correctif, chaque composant obtenait sa propre
// ligne et tout panneau de plus de 5 composants était rejeté par Discord
// (Invalid Form Body).

const test = require("node:test");
const assert = require("node:assert/strict");
const { payload, toActionRows, MAX_ACTION_ROWS, MAX_BUTTONS_PER_ROW } = require("../../../src/adapters/discord/DiscordResponseTransport");

const button = (customId) => ({ type: "button", customId, label: customId, style: "secondary" });
const select = (customId) => ({ type: "select", customId, placeholder: "pick", options: [{ value: "a", label: "A" }] });
const channelSelect = (customId) => ({ type: "channel-select", customId, placeholder: "pick", channelTypes: [0] });

function rowCustomIds(row) { return row.components.map((component) => component.data.custom_id); }

test("12 consecutive buttons are packed into 3 rows of at most 5, preserving order", () => {
  const buttons = Array.from({ length: 12 }, (_, index) => button(`b${index}`));
  const rows = toActionRows(buttons);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((row) => row.components.length), [5, 5, 2]);
  assert.deepEqual(rows.flatMap(rowCustomIds), buttons.map((component) => component.customId));
});

test("select menus always occupy their own row while button runs stay packed", () => {
  const rows = toActionRows([button("a"), button("b"), select("s1"), button("c"), channelSelect("ch"), button("d"), button("e")]);
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.map((row) => row.components.length), [2, 1, 1, 1, 2]);
  assert.deepEqual(rows.flatMap(rowCustomIds), ["a", "b", "s1", "c", "ch", "d", "e"]);
});

test("exactly 5 rows is accepted, a 6th row is rejected with an explicit error", () => {
  const fiveRows = [select("s1"), select("s2"), select("s3"), select("s4"), button("b")];
  assert.equal(toActionRows(fiveRows).length, 5);
  const sixRows = [...fiveRows, select("s5")];
  assert.throws(() => toActionRows(sixRows), /5 action rows/);
  assert.throws(() => payload({ content: "x", components: Array.from({ length: 26 }, (_, index) => button(`b${index}`)) }), /5 action rows/);
});

test("payload uses packing so a 12-button view stays within Discord limits", () => {
  const view = { title: "t", content: "c", components: Array.from({ length: 12 }, (_, index) => button(`b${index}`)) };
  const result = payload(view, false);
  assert.ok(result.components.length <= MAX_ACTION_ROWS);
  for (const row of result.components) assert.ok(row.components.length <= MAX_BUTTONS_PER_ROW);
  assert.equal(result.components.reduce((total, row) => total + row.components.length, 0), 12);
});

test("single button view keeps the historical one-row shape", () => {
  const result = payload({ title: "Title", content: "Content", components: [button("civrat:v1:x:y")] }, true);
  assert.equal(result.components.length, 1);
  assert.equal(result.components[0].components.length, 1);
});
