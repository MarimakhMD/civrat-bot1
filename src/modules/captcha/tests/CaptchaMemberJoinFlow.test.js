"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createCaptchaRuntime } = require("../runtime/createCaptchaRuntime");
const { CaptchaConfigKey: Key } = require("../configuration/captchaConstants");
const { CaptchaPanelDeliveryService, activePanels } = require("../services/CaptchaPanelDeliveryService");

function joinHarness({ config = {}, roles = new Map() } = {}) {
  activePanels.clear();
  let current = { [Key.ENABLED]: true, [Key.ROLE_ID]: "r-ver", [Key.CHANNEL_ID]: "c1", [Key.UNVERIFIED_ROLE_ID]: "r-unv", ...config };
  const calls = { createRole: [], assigned: [], unassigned: [], dms: [], sentPanels: [], deletedPanels: [], fetchMembers: 0, updates: [] };
  const resolver = {
    get: async () => ({ ...current }),
    update: async (_g, patch) => { calls.updates.push(patch); current = { ...current, ...patch }; return { ...current }; },
  };
  const transport = {
    wrapMember: (m) => ({ id: m.id, roleIds: [...m.roles.cache.keys()], discordMember: m }),
    getRole: async (id) => roles.get(id) || null,
    createRole: async (name) => { calls.createRole.push(name); const id = `created-${calls.createRole.length}`; roles.set(id, { id, position: 1 }); return { id }; },
    assignRole: async (m, role) => { calls.assigned.push([m.id, role?.id]); },
    unassignRole: async (m, role) => { calls.unassigned.push([m.id, role?.id]); },
    ensureChannelControl: async () => ({ ok: true, changed: false }),
    createCaptchaChannel: async (name) => ({ id: `chan-${name}` }),
    sendPanel: async (channelId) => { calls.sentPanels.push(channelId); return { id: `panel-${calls.sentPanels.length}` }; },
    deletePanel: async (channelId, messageId) => { calls.deletedPanels.push([channelId, messageId]); },
    sendReminder: async (_m, payload) => { calls.dms.push(payload); },
    fetchMembers: async () => { calls.fetchMembers += 1; return []; },
  };
  const runtime = createCaptchaRuntime({ guildConfigResolver: resolver, transportFactory: () => transport });
  return { runtime, calls, config: () => ({ ...current }), transport };
}

function buildMember({ id = "m1", guildId = "g1", bot = false, roleIds = [] } = {}) {
  return {
    id,
    user: { bot, send: async (content) => { /* DM capturé via transport */ return content; } },
    roles: { cache: new Map(roleIds.map((r) => [r, {}])) },
    guild: { id: guildId, preferredLocale: "fr" },
  };
}

test("join flow — human gets the unverified role, DM status and a regenerated panel", async () => {
  const h = joinHarness({ config: { [Key.UNVERIFIED_ROLE_ID]: null, [Key.PANEL_MESSAGE_ID]: null }, roles: new Map([["r-ver", { id: "r-ver", position: 1 }]]) });
  const member = buildMember();
  const result = await h.runtime.handleMemberJoined(member);

  assert.equal(result.sent, true, "DM de statut envoyé");
  assert.equal(result.roles.unverifiedApplied, true, "rôle non vérifié appliqué");
  assert.ok(h.calls.assigned.some(([mid, rid]) => mid === "m1" && rid === "created-1"), "rôle créé puis appliqué");
  assert.equal(h.calls.unassigned.length, 0, "aucun retrait si le rôle vérifié n'était pas porté");
  assert.equal(h.calls.sentPanels.length, 1, "panneau régénéré (aucun persisté)");
  assert.ok(h.config()[Key.PANEL_MESSAGE_ID], "ids du panneau persistés");
  assert.equal(h.calls.fetchMembers, 0, "aucun scan des membres existants au join");
});

test("join flow — verified member loses the verified role and receives the unverified one", async () => {
  const h = joinHarness({
    config: { [Key.PANEL_CHANNEL_ID]: "c1", [Key.PANEL_MESSAGE_ID]: "pm-old" },
    roles: new Map([["r-ver", { id: "r-ver", position: 1 }], ["r-unv", { id: "r-unv", position: 1 }]]),
  });
  const member = buildMember({ roleIds: ["r-ver"] });
  const result = await h.runtime.handleMemberJoined(member);

  assert.deepEqual(h.calls.unassigned, [["m1", "r-ver"]], "rôle vérifié retiré");
  assert.deepEqual(h.calls.assigned, [["m1", "r-unv"]], "rôle non vérifié appliqué");
  assert.equal(result.roles.verifiedRemoved, true);
  assert.equal(result.roles.unverifiedApplied, true);
  assert.equal(h.calls.dms.length, 1, "DM de statut non vérifié");
  assert.equal(h.calls.sentPanels.length, 0, "panneau déjà persisté : aucun envoi");
});

test("join flow — existing members are never scanned, only the joiner is touched", async () => {
  const h = joinHarness();
  const member = buildMember();
  await h.runtime.handleMemberJoined(member);
  assert.equal(h.calls.fetchMembers, 0, "aucun fetch de membres");
  assert.ok(h.calls.assigned.length <= 1, "uniquement le rôle du membre arrivant");
});

test("join flow — role failures never throw and are reported", async () => {
  const h = joinHarness();
  h.transport.assignRole = async () => { throw new Error("Missing Permissions"); };
  const result = await h.runtime.handleMemberJoined(buildMember());
  assert.equal(result.roles.unverifiedApplied, false);
  assert.ok(result.roles.failures.length >= 1, "échec remonté");
  assert.equal(result.sent, true, "le DM de statut part malgré l'échec de rôle");
});

test("join flow — startup reconciliation delivers exactly one panel per guild", async () => {
  activePanels.clear();
  let current = { [Key.ENABLED]: true, [Key.ROLE_ID]: "r", [Key.CHANNEL_ID]: "c1" };
  const resolver = {
    get: async () => ({ ...current }),
    update: async (_g, patch) => { current = { ...current, ...patch }; return { ...current }; },
  };
  const sent = [];
  const transport = {
    sendPanel: async (channelId) => { sent.push(channelId); return { id: `p-${sent.length}` }; },
    deletePanel: async () => {},
  };
  const runtime = createCaptchaRuntime({ guildConfigResolver: resolver, transportFactory: () => transport });
  const client = { guilds: { cache: new Map([["g1", { id: "g1", preferredLocale: "fr" }]]) } };
  const summary = await runtime.reconcilePanelsOnStartup(client);
  assert.deepEqual(summary, { guilds: 1, delivered: 1, skipped: 0, failed: 0 });
  assert.equal(sent.length, 1);
  assert.equal(current[Key.PANEL_MESSAGE_ID], "p-1", "ids persistés au démarrage");

  // Second démarrage : l'ancien panneau est supprimé avant le nouveau (un seul à la fois).
  const deleted = [];
  transport.deletePanel = async (channelId, messageId) => { deleted.push([channelId, messageId]); };
  transport.sendPanel = async (channelId) => { sent.push(channelId); return { id: `p-${sent.length}` }; };
  const summary2 = await runtime.reconcilePanelsOnStartup(client);
  assert.equal(summary2.delivered, 1);
  assert.deepEqual(deleted, [["c1", "p-1"]], "ancien panneau supprimé");
  assert.equal(current[Key.PANEL_MESSAGE_ID], "p-2");
});

test("join flow — disabled guild and bots are untouched", async () => {
  const h = joinHarness({ config: { [Key.ENABLED]: false } });
  const disabled = await h.runtime.handleMemberJoined(buildMember());
  assert.equal(disabled.code, "CAPTCHA_DISABLED");
  const bot = await h.runtime.handleMemberJoined(buildMember({ bot: true }));
  assert.equal(bot.code, "BOT_MEMBER");
  assert.equal(h.calls.assigned.length, 0);
  assert.equal(h.calls.dms.length, 0);
  assert.equal(h.calls.fetchMembers, 0);
});
