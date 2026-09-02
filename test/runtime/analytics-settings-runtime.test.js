"use strict";

// Phase 11 — intégration runtime complète Analytics/XP/Invites via la vraie
// composition /settings : UN SEUL stockage est lu et écrit partout (fin des
// instances disjointes), sections XP et Invites présentes, non-configuré
// inchangé, limites Discord respectées.
//
// Hors ligne : pas de Supabase ni de Mongo connecté — les éditions de config
// passent par un store partagé qui joue le rôle de la table guild_configs,
// exactement comme en production où les deux chemins lisent la même table.

const test = require("node:test");
const assert = require("node:assert/strict");

// Le store partagé DOIT être patchée avant toute construction de runtime
// (le runtime Analytics lit les fonctions du module legacy à sa création).
const sharedStore = { g: { language: "fr" } };
const guildConfigModule = require("../../src/services/guildConfig");
sharedStore.getGuildConfig = async (guildId) => sharedStore[guildId] ? { ...sharedStore[guildId] } : {};
const originalGet = guildConfigModule.getGuildConfig;
const originalUpdate = guildConfigModule.updateGuildConfig;
guildConfigModule.getGuildConfig = sharedStore.getGuildConfig;
guildConfigModule.updateGuildConfig = async (guildId, updates) => { sharedStore[guildId] = { ...(sharedStore[guildId] || { language: "fr" }), ...updates }; return sharedStore[guildId]; };

const { createGuildSettingsRuntime } = require("../../src/runtime/createGuildSettingsRuntime");
const { getAnalyticsRuntime } = require("../../src/modules/analytics/runtime/getAnalyticsRuntime");
const { getXPRuntime } = require("../../src/modules/xp/runtime/getXPRuntime");
const legacyInviteService = require("../../src/services/inviteService");
const { MAX_ACTION_ROWS, MAX_BUTTONS_PER_ROW } = require("../../src/adapters/discord/DiscordResponseTransport");
const { XPComponentId: XPId } = require("../../src/modules/xp/configuration/xpConstants");
const { InviteComponentId: InviteId } = require("../../src/modules/invites/configuration/inviteConstants");
const { SettingsComponentId } = require("../../src/modules/guild-settings/interactions/settingsComponents");

function base(captured, extra = {}) {
  return {
    isChatInputCommand: () => false,
    isAutocomplete: () => false,
    isButton: () => false,
    isStringSelectMenu: () => false,
    isChannelSelectMenu: () => false,
    isModalSubmit: () => false,
    guildId: "g",
    user: { id: "u1" },
    member: { id: "u1", permissions: { has: () => true } },
    commandName: null,
    customId: null,
    values: [],
    reply: async (payload) => { captured.reply = payload; },
    followUp: async () => {},
    update: async (payload) => { captured.update = payload; },
    showModal: async (modal) => { captured.modal = modal; },
    ...extra,
  };
}

function command(name, captured, options = null) {
  return base(captured, { isChatInputCommand: () => true, commandName: name, options });
}

function button(customId, captured) {
  return base(captured, { isButton: () => true, customId });
}

function stringSelect(customId, values, captured) {
  return base(captured, { isStringSelectMenu: () => true, customId, values });
}

function rendered(captured) { return captured.update || captured.reply || null; }
function contains(payload, needle) { return JSON.stringify(payload || {}).includes(needle); }

function assertLimits(payload, label) {
  assert.ok(payload, `${label} produced no payload`);
  const rows = payload.components || [];
  assert.ok(rows.length <= MAX_ACTION_ROWS, `${label} renders ${rows.length} rows`);
  for (const row of rows) assert.ok(row.components.length <= MAX_BUTTONS_PER_ROW, `${label} has an oversized row`);
}

const runtime = createGuildSettingsRuntime({ legacyConfigService: { getGuildConfig: sharedStore.getGuildConfig, updateGuildConfig: guildConfigModule.updateGuildConfig, invalidateCache: async () => {} } });

test("settings Analytics category exposes Analytics, XP, and Invites within Discord limits", async () => {
  const home = {};
  assert.equal(await runtime.tryHandle(command("settings", home)), true);
  assertLimits(rendered(home), "settings home");
  assert.ok(contains(rendered(home), SettingsComponentId.CATEGORY));

  const captured = {};
  assert.equal(await runtime.tryHandle(stringSelect(SettingsComponentId.CATEGORY, ["analytics"], captured)), true);
  const payload = rendered(captured);
  assertLimits(payload, "settings analytics category");
  assert.ok(contains(payload, XPId.SECTION), "Analytics category misses the XP section");
  assert.ok(contains(payload, InviteId.SECTION), "Analytics category misses the Invites section");
  assert.ok(contains(payload, "civrat:v1:analytics:section"), "Analytics category lost the Analytics section");
});

test("end-to-end: enabling Analytics then tracking events makes them visible in /analytics", async () => {
  // Activation via le bouton /settings (écriture dans le store partagé).
  const toggled = {};
  assert.equal(await runtime.tryHandle(button("civrat:v1:analytics:toggle", toggled)), true);
  assert.equal(sharedStore.g.analytics_enabled, true, "toggle must persist analytics_enabled");

  // Chemin d'écriture des événements (messageCreate / guildMemberAdd).
  const analytics = getAnalyticsRuntime();
  assert.equal((await analytics.trackMessage({ guild: { id: "g" }, author: { id: "u1", bot: false } })).tracked, true);
  assert.equal((await analytics.trackMessage({ guild: { id: "g" }, author: { id: "u1", bot: false } })).tracked, true);
  assert.equal((await analytics.trackMember({ guild: { id: "g" }, id: "u2" })).tracked, true);

  // XP écrite par le runtime XP réel, invitations par le service legacy réel.
  await getXPRuntime()._repository.upsert("g", "grinder", 420, 4);
  await legacyInviteService.statsRepository.addInvite("recruiter", "g");

  const overview = {};
  assert.equal(await runtime.tryHandle(command("analytics", overview)), true);
  const payload = rendered(overview);
  assert.ok(contains(payload, "Messages : 2"), "overview must show the 2 tracked messages");
  assert.ok(contains(payload, "Membres : 1"), "overview must show the tracked member");
  assert.ok(contains(payload, "<@grinder>"), "overview must show the XP leader");
  assert.ok(contains(payload, "<@recruiter>"), "overview must show the invite leader");

  const xp = {};
  assert.equal(await runtime.tryHandle(command("analytics_xp", xp)), true);
  assert.ok(contains(rendered(xp), "<@grinder>"), "/analytics_xp must read the XP runtime store");
  assert.ok(contains(rendered(xp), "420"), "/analytics_xp must show the XP value");

  const invites = {};
  assert.equal(await runtime.tryHandle(command("analytics_invites", invites)), true);
  assert.ok(contains(rendered(invites), "<@recruiter>"), "/analytics_invites must read the legacy invite store");

  const publicInvites = {};
  assert.equal(await runtime.tryHandle(command("invites", publicInvites, { getUser: () => null, getBoolean: () => true })), true);
  assert.ok(contains(rendered(publicInvites), "recruiter"), "/invites leaderboard must read the same store");
});

// A2 (DCA4) — la restriction de l'XP à un salon est supprimée : la colonne
// xp_channel_id n'existe pas en base. La section ne pilote plus que xp_enabled.
test("XP settings section toggles xp_enabled and exposes no channel restriction", async () => {
  assert.equal(sharedStore.g.xp_enabled, undefined, "xp must start unconfigured");
  assert.equal(XPId.CHANNEL, undefined, "le componentId CHANNEL doit avoir disparu");
  const section = {};
  assert.equal(await runtime.tryHandle(button(XPId.SECTION, section)), true);
  assertLimits(rendered(section), "xp section");
  assert.ok(contains(rendered(section), XPId.TOGGLE));
  const toggled = {};
  assert.equal(await runtime.tryHandle(button(XPId.TOGGLE, toggled)), true);
  assert.equal(sharedStore.g.xp_enabled, true, "toggle must persist xp_enabled");
  const rerendered = {};
  assert.equal(await runtime.tryHandle(button(XPId.SECTION, rerendered)), true);
  assert.ok(!contains(rendered(rerendered), "channel-select"), "aucun sélecteur de salon XP");
  assert.equal(sharedStore.g.xp_channel_id, undefined, "aucune interaction ne doit écrire xp_channel_id");
  assert.equal(sharedStore.g.xp_rate, undefined, "aucune interaction ne doit écrire xp_rate");
});

test("Invites settings section renders status, toggles invitations_enabled and goes back via composition", async () => {
  const section = {};
  assert.equal(await runtime.tryHandle(button(InviteId.SECTION, section)), true);
  const payload = rendered(section);
  assertLimits(payload, "invites section");
  assert.ok(contains(payload, InviteId.TOGGLE));
  assert.ok(contains(payload, "activées"), "default state must read as enabled (historical always-on tracking)");
  const toggled = {};
  assert.equal(await runtime.tryHandle(button(InviteId.TOGGLE, toggled)), true);
  assert.equal(sharedStore.g.invitations_enabled, false, "toggle must persist the opt-out");
  assert.ok(contains(rendered(toggled), "désactivées"));
  const backed = {};
  assert.equal(await runtime.tryHandle(button(InviteId.BACK, backed)), true);
  assert.ok(contains(rendered(backed), SettingsComponentId.CATEGORY), "Back must render the categorized settings home again");
});

test("unconfigured guild keeps the historical behavior: tracking off, zeros, no crash", async () => {
  const guildId = "g2";
  const analytics = getAnalyticsRuntime();
  assert.equal((await analytics.trackMessage({ guild: { id: guildId }, author: { id: "u9", bot: false } })).code, "ANALYTICS_DISABLED");
  const captured = {};
  const interaction = base(captured, { isChatInputCommand: () => true, commandName: "analytics", guildId });
  assert.equal(await runtime.tryHandle(interaction), true);
  assert.ok(contains(rendered(captured), "Messages : 0"), "unconfigured guild sees zeros");
});

test("legacy invite tracking guard semantics : explicit opt-out only", () => {
  const fs = require("node:fs");
  const add = fs.readFileSync("src/events/guildMemberAdd.js", "utf8");
  const remove = fs.readFileSync("src/events/guildMemberRemove.js", "utf8");
  assert.match(add, /config\.invitations_enabled !== false/, "add path must preserve the historical default-on tracking");
  assert.match(remove, /config\.invitations_enabled === false/, "remove path must keep the same guard semantics");
  assert.match(remove, /inviteService\.getInviteStats/, "remove path must read invitedBy from the shared store, not the orphan mongoose model");
});

test.after(() => {
  guildConfigModule.getGuildConfig = originalGet;
  guildConfigModule.updateGuildConfig = originalUpdate;
});
