"use strict";

// ───────────────────────────────────────────────────────────────
// 4F-1 — observabilité de l'annonce Giveaway.
//
// L'échec d'envoi Discord n'annule pas un giveaway déjà persisté (comportement
// inchangé : `ok: true, code: "GIVEAWAY_CREATED"`), mais il est désormais
// journalisé (`operation: "giveaway_announce"`) et jamais levé.
// ───────────────────────────────────────────────────────────────

const test = require("node:test");
const assert = require("node:assert/strict");
const { GiveawayService } = require("../services/GiveawayService");

function mockRepo() {
  return {
    create: async () => ({ id: "g1", guild_id: "g1", channel_id: "c1", title: "prize", active: true, status: "active" }),
  };
}

const enabled = { read: async () => ({ giveaways_enabled: true }) };

test("4F-1: un envoi Discord qui échoue reste un succès de création et est journalisé", async () => {
  const warns = [];
  const logger = { warn: (msg, meta) => warns.push({ msg, meta }) };
  const svc = new GiveawayService({
    configService: enabled,
    repository: mockRepo(),
    transport: { sendGiveaway: async () => { throw new Error("channel gone"); } },
    logger,
  });

  const result = await svc.create({ guildId: "g1", channelId: "c1", title: "prize" });

  assert.equal(result.ok, true, "le giveaway reste créé");
  assert.equal(result.code, "GIVEAWAY_CREATED");

  const warn = warns.find((w) => w.meta.operation === "giveaway_announce");
  assert.ok(warn, "un log giveaway_announce est émis");
  assert.equal(warn.meta.guildId, "g1");
  assert.equal(warn.meta.giveawayId, "g1");
  assert.equal(warn.meta.error, "channel gone");
});

test("4F-1: un log hook qui échoue est journalisé et non bloquant", async () => {
  const warns = [];
  const logger = { warn: (msg, meta) => warns.push({ msg, meta }) };
  const svc = new GiveawayService({
    configService: enabled,
    repository: mockRepo(),
    transport: { sendGiveaway: async () => {} },
    logsRuntime: { disabled: false, handleModerationEvent: async () => { throw new Error("logs down"); } },
    logger,
  });

  const result = await svc.create({ guildId: "g1", channelId: "c1", title: "prize" });
  assert.equal(result.ok, true);

  const warn = warns.find((w) => w.meta.operation === "giveaway_log");
  assert.ok(warn, "un log giveaway_log est émis");
  assert.equal(warn.meta.error, "logs down");
});

test("4F-1: aucun warn quand tout réussit", async () => {
  const warns = [];
  const logger = { warn: (msg, meta) => warns.push({ msg, meta }) };
  const svc = new GiveawayService({
    configService: enabled,
    repository: mockRepo(),
    transport: { sendGiveaway: async () => {} },
    logger,
  });

  await svc.create({ guildId: "g1", channelId: "c1", title: "prize" });
  assert.equal(warns.length, 0);
});
