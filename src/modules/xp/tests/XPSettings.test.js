"use strict";

// A2 — intégration /settings du module XP : sous-vue, toggle et retour au
// panneau via settingsHome.
//
// Le double de configService n'est plus un pass-through aveugle : il applique
// la MÊME liste blanche que la production (isGuildConfigKey), ce qui est la
// règle réellement imposée par updateGuildConfig depuis A1. Sans cela, un test
// peut écrire xp_channel_id et passer au vert alors que la production échoue.

const test = require("node:test");
const assert = require("node:assert/strict");
const { InteractionRegistry } = require("../../../core/interactions");
const { PermissionName } = require("../../../core/permissions");
const { toActionRows, MAX_ACTION_ROWS, MAX_BUTTONS_PER_ROW } = require("../../../adapters/discord/DiscordResponseTransport");
const { registerXPSettings } = require("../register");
const { xpSettingsView } = require("../interactions/xpSettingsViews");
const { XPComponentId: Id, XP_DEFAULTS } = require("../configuration/xpConstants");
const { isGuildConfigKey } = require("../../../services/guildConfigKeys");

const t = (key) => key;

function makeContext(store) {
  const captured = {};
  const configService = {
    read: async () => ({ ...XP_DEFAULTS, ...store }),
    update: async (_guildId, updates) => {
      // Règle de production : toute clé hors liste blanche est refusée.
      const unknown = Object.keys(updates).filter((key) => !isGuildConfigKey(key));
      if (unknown.length > 0) {
        throw new Error(`unknown guild_config key(s): ${unknown.join(", ")}`);
      }
      return Object.assign(store, updates);
    },
  };
  const context = {
    guildId: "g",
    t,
    envelope: { values: [], transport: { update: async (payload) => { captured.update = payload; } } },
  };
  return { context, configService, captured, store };
}

test("A2 — the CHANNEL componentId is gone for good", () => {
  assert.equal(Id.CHANNEL, undefined, "le componentId CHANNEL doit avoir disparu (DCA4)");
  assert.deepEqual(Object.keys(Id).sort(), ["BACK", "SECTION", "TOGGLE"]);
});

test("xpSettingsView reflects the disabled/enabled states with 2 controls", () => {
  const off = xpSettingsView({ t, config: { xp_enabled: false } });
  assert.equal(off.components.length, 2, "toggle + retour, plus aucun select de salon");
  assert.equal(off.components[0].label, "xp.enable");
  assert.ok(off.content.includes("xp.disabled"));
  assert.ok(off.content.includes("xp.perMessageLine"), "le gain appliqué doit être affiché");
  assert.ok(off.content.includes("xp.cooldownLine"), "le cooldown appliqué doit être affiché");

  const on = xpSettingsView({ t, config: { xp_enabled: true } });
  assert.equal(on.components[0].label, "xp.disable");
  assert.ok(on.content.includes("xp.enabled"));

  for (const view of [off, on]) {
    assert.ok(view.components.every((c) => c.type !== "channel-select"),
      "aucun channel-select ne doit subsister");
    const rows = toActionRows(view.components);
    assert.ok(rows.length <= MAX_ACTION_ROWS);
    for (const row of rows) assert.ok(row.components.length <= MAX_BUTTONS_PER_ROW);
  }
});

test("A2 — xpSettingsView shows the values actually applied, including defaults", () => {
  const realT = (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key);
  const view = xpSettingsView({ t: realT, config: { xp_enabled: true } });
  assert.ok(view.content.includes('"amount":15'), "gain par défaut 15");
  assert.ok(view.content.includes('"seconds":60'), "cooldown par défaut 60 s");

  const tuned = xpSettingsView({ t: realT, config: { xp_enabled: true, xp_per_message: 30, xp_cooldown: 0 } });
  assert.ok(tuned.content.includes('"amount":30'));
  assert.ok(tuned.content.includes('"seconds":0'));
});

test("registerXPSettings wires section, toggle and back with MANAGE_GUILD", async () => {
  const registry = new InteractionRegistry();
  const { context, configService, captured, store } = makeContext({});
  let homeCalls = 0;
  registerXPSettings({ registry, configService, settingsHome: async () => { homeCalls += 1; } });

  for (const customId of [Id.SECTION, Id.TOGGLE, Id.BACK]) {
    const route = registry.find({ kind: "button", customId });
    assert.ok(route, `${customId} not registered`);
    assert.deepEqual(route.permissions.allOf, [PermissionName.MANAGE_GUILD]);
  }

  // section renders the sub-view
  await registry.find({ kind: "button", customId: Id.SECTION }).execute(context);
  assert.ok(captured.update, "section render must update the message");

  // toggle flips xp_enabled
  await registry.find({ kind: "button", customId: Id.TOGGLE }).execute(context);
  assert.equal(store.xp_enabled, true);

  // back delegates to the composed settings home (no hardcoded view)
  await registry.find({ kind: "button", customId: Id.BACK }).execute(context);
  assert.equal(homeCalls, 1);
});

test("A2 — no interaction writes xp_channel_id or xp_rate any more", async () => {
  const registry = new InteractionRegistry();
  const { context, configService, store } = makeContext({});
  registerXPSettings({ registry, configService, settingsHome: async () => {} });

  // Plus aucune route select-menu n'est enregistrée par le module XP.
  for (const key of ["xp_channel_id", "xp_rate"]) {
    assert.equal(store[key], undefined);
  }

  // Le double refuse désormais ces clés, comme la production.
  await assert.rejects(
    () => configService.update("g", { xp_channel_id: "chan-9" }),
    /xp_channel_id/,
    "écrire xp_channel_id doit être refusé"
  );
  await assert.rejects(
    () => configService.update("g", { xp_rate: 2 }),
    /xp_rate/,
    "écrire xp_rate doit être refusé"
  );

  // Les clés réelles restent acceptées.
  await configService.update("g", { xp_per_message: 25, xp_cooldown: 120 });
  assert.equal(store.xp_per_message, 25);
  assert.equal(store.xp_cooldown, 120);
});
