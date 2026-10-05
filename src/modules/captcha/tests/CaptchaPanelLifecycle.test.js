"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { CaptchaPanelDeliveryService, activePanels, activeDeliveries } = require("../services/CaptchaPanelDeliveryService");
const { CaptchaConfigKey: Key } = require("../configuration/captchaConstants");

const view = { title: "t", content: "c", components: [{ customId: "civrat:v1:captcha:verify", label: "verify" }] };

function harness({ config = {}, sendCount = { n: 0 }, failUpdate = false, prefix = "m" } = {}) {
  let current = { [Key.ENABLED]: true, [Key.CHANNEL_ID]: "c1", [Key.ROLE_ID]: "r1", ...config };
  const calls = { sent: [], deleted: [], updates: [] };
  const configService = {
    read: async () => ({ ...current }),
    update: async (_g, patch) => {
      if (failUpdate) throw new Error("column missing");
      calls.updates.push(patch);
      current = { ...current, ...patch };
      return { ...current };
    },
  };
  const panelService = { build: async () => ({ ready: true, channelId: current[Key.CHANNEL_ID], roleId: current[Key.ROLE_ID], view }) };
  let messageSeq = 0;
  const transport = {
    sendPanel: async (channelId) => { calls.sent.push(channelId); sendCount.n += 1; messageSeq += 1; return { id: `${prefix}${messageSeq}` }; },
    deletePanel: async (channelId, messageId) => { calls.deleted.push([channelId, messageId]); },
  };
  const delivery = new CaptchaPanelDeliveryService({ panelService, transport, configService });
  return { delivery, calls, config: () => ({ ...current }), sendCount };
}

test("panel lifecycle — delivery persists panel ids in config", async () => {
  activePanels.clear();
  const h = harness();
  const result = await h.delivery.deliver("g1", (k) => k);
  assert.equal(result.delivered, true);
  assert.equal(result.persisted, true);
  assert.equal(h.config()[Key.PANEL_MESSAGE_ID], "m1");
  assert.equal(h.config()[Key.PANEL_CHANNEL_ID], "c1");
});

test("panel lifecycle — regeneration deletes the stored panel first, then updates ids", async () => {
  activePanels.clear();
  const h = harness({ config: { [Key.PANEL_CHANNEL_ID]: "old-c", [Key.PANEL_MESSAGE_ID]: "old-m" } });
  const result = await h.delivery.deliver("g1", (k) => k);
  assert.equal(result.regenerated, true);
  assert.deepEqual(h.calls.deleted, [["old-c", "old-m"]], "ancien panneau supprimé avant le nouveau");
  assert.deepEqual(h.calls.sent, ["c1"]);
  assert.equal(h.config()[Key.PANEL_MESSAGE_ID], "m1", "ids mis à jour");
  assert.equal(h.config()[Key.PANEL_CHANNEL_ID], "c1");
});

test("panel lifecycle — restart with persisted ids regenerates instead of duplicating", async () => {
  activePanels.clear();
  // Session 1 : livraison initiale.
  const s1 = harness();
  await s1.delivery.deliver("g2", (k) => k);
  const stored = { [Key.PANEL_CHANNEL_ID]: s1.config()[Key.PANEL_CHANNEL_ID], [Key.PANEL_MESSAGE_ID]: s1.config()[Key.PANEL_MESSAGE_ID] };
  // Session 2 (« redémarrage ») : nouvel objet service, même config persistée.
  const s2 = harness({ config: stored, prefix: "s2m" });
  const result = await s2.delivery.deliver("g2", (k) => k);
  assert.equal(result.delivered, true);
  assert.equal(result.regenerated, true, "l'ancien panneau persisté est supprimé");
  assert.deepEqual(s2.calls.deleted, [[stored[Key.PANEL_CHANNEL_ID], stored[Key.PANEL_MESSAGE_ID]]]);
  assert.equal(s2.calls.sent.length, 1, "un seul nouveau panneau");
  assert.notEqual(s2.config()[Key.PANEL_MESSAGE_ID], stored[Key.PANEL_MESSAGE_ID]);
});

test("panel lifecycle — concurrent deliveries are refused (no official panel race)", async () => {
  activePanels.clear();
  activeDeliveries.clear();
  let release;
  const gate = new Promise((r) => { release = r; });
  const h = harness();
  // Ralentit le premier sendPanel pour créer le chevauchement.
  const original = h.delivery.transport;
  h.delivery.transport = {
    ...original,
    sendPanel: async (channelId, v) => { await gate; return original.sendPanel(channelId, v); },
  };
  const first = h.delivery.deliver("g3", (k) => k);
  const second = await h.delivery.deliver("g3", (k) => k);
  assert.equal(second.delivered, false);
  assert.equal(second.reason, "captcha.panelDeliveryInProgress");
  release();
  const firstResult = await first;
  assert.equal(firstResult.delivered, true);
  assert.equal(h.calls.sent.length, 1, "un seul panneau publié");
});

test("panel lifecycle — persist failure degrades gracefully (ids kept in memory)", async () => {
  activePanels.clear();
  const h = harness({ failUpdate: true });
  const result = await h.delivery.deliver("g4", (k) => k);
  assert.equal(result.delivered, true, "l'envoi reste réussi");
  assert.equal(result.persisted, false);
  // Relecture via Map : la session courante reste cohérente.
  assert.deepEqual(activePanels.get("g4"), { channelId: "c1", messageId: "m1" });
});

test("panel lifecycle — incomplete configuration never sends", async () => {
  activePanels.clear();
  const h = harness();
  h.delivery.panelService = { build: async () => ({ ready: false, reason: "captcha.channelMissing" }) };
  const result = await h.delivery.deliver("g5", (k) => k);
  assert.equal(result.delivered, false);
  assert.equal(h.calls.sent.length, 0);
});
