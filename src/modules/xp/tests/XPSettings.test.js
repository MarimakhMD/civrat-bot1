"use strict";

// Phase 11 — intégration /settings du module XP : sous-vue, toggle, salon
// restreint et retour au panneau via settingsHome.

const test = require("node:test");
const assert = require("node:assert/strict");
const { InteractionRegistry } = require("../../../core/interactions");
const { PermissionName } = require("../../../core/permissions");
const { toActionRows, MAX_ACTION_ROWS, MAX_BUTTONS_PER_ROW } = require("../../../adapters/discord/DiscordResponseTransport");
const { registerXPSettings } = require("../register");
const { xpSettingsView } = require("../interactions/xpSettingsViews");
const { XPComponentId: Id } = require("../configuration/xpConstants");

const t = (key) => key;

function makeContext(store) {
  const captured = {};
  const configService = {
    read: async () => ({ xp_enabled: false, xp_channel_id: null, xp_rate: 1, ...store }),
    update: async (_g, updates) => Object.assign(store, updates),
  };
  const context = {
    guildId: "g",
    t,
    envelope: { values: [], transport: { update: async (payload) => { captured.update = payload; } } },
  };
  return { context, configService, captured, store };
}

test("xpSettingsView reflects the disabled/enabled states with 3 controls", () => {
  const off = xpSettingsView({ t, config: { xp_enabled: false, xp_channel_id: null } });
  assert.equal(off.components.length, 3);
  assert.equal(off.components[0].label, "xp.enable");
  assert.ok(off.content.includes("xp.disabled"));
  const on = xpSettingsView({ t, config: { xp_enabled: true, xp_channel_id: "c1" } });
  assert.equal(on.components[0].label, "xp.disable");
  assert.ok(on.content.includes("xp.enabled"));
  for (const view of [off, on]) {
    const rows = toActionRows(view.components);
    assert.ok(rows.length <= MAX_ACTION_ROWS);
    for (const row of rows) assert.ok(row.components.length <= MAX_BUTTONS_PER_ROW);
  }
});

test("registerXPSettings wires section, toggle, channel select and back with MANAGE_GUILD", async () => {
  const registry = new InteractionRegistry();
  const { context, configService, captured, store } = makeContext({});
  let homeCalls = 0;
  registerXPSettings({ registry, configService, settingsHome: async () => { homeCalls += 1; } });

  for (const customId of [Id.SECTION, Id.TOGGLE, Id.CHANNEL, Id.BACK]) {
    const route = registry.find({ kind: customId === Id.CHANNEL ? "select-menu" : "button", customId });
    assert.ok(route, `${customId} not registered`);
    assert.deepEqual(route.permissions.allOf, [PermissionName.MANAGE_GUILD]);
  }

  // section renders the sub-view
  await registry.find({ kind: "button", customId: Id.SECTION }).execute(context);
  assert.ok(captured.update, "section render must update the message");

  // toggle flips xp_enabled
  await registry.find({ kind: "button", customId: Id.TOGGLE }).execute(context);
  assert.equal(store.xp_enabled, true);

  // channel select writes xp_channel_id
  context.envelope.values = ["chan-9"];
  await registry.find({ kind: "select-menu", customId: Id.CHANNEL }).execute(context);
  assert.equal(store.xp_channel_id, "chan-9");

  // back delegates to the composed settings home (no hardcoded view)
  await registry.find({ kind: "button", customId: Id.BACK }).execute(context);
  assert.equal(homeCalls, 1);
});
