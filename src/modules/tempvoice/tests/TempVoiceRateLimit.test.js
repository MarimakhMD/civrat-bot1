"use strict";

/**
 * P6 §12 — rate-limit TempVoice : 4 créations de salon / 60 s par (guild, user).
 *
 * Verrouille : 4 créations autorisées, 5e refusée (AUCUNE création de salon,
 * AUCUNE écriture DB), une entrée qui n'aboutit pas à une création ne consomme
 * rien, isolations user et guild, expiration 60 s, service SANS garde = comportement
 * historique préservé (tests unitaires existants).
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { TempVoiceService } = require("../services/TempVoiceService");
const { ActionRateLimitGuard, RATE_LIMITS } = require("../../../core/rateLimit/ActionRateLimitGuard");

function harness({ guildId = "g1", guard = null } = {}) {
  const created = [];
  const inserted = [];
  const moved = [];
  const transport = {
    createChannel: async (payload) => { created.push(payload); return { id: `chan-${created.length}` }; },
    moveMember: async (member, channelId) => { moved.push({ member, channelId }); },
  };
  const repository = { create: async (row) => { inserted.push(row); } };
  const config = { tempvoice_enabled: true, tempvoice_lobby_channel_id: "lobby" };
  const service = new TempVoiceService({
    transport,
    config,
    tempChannels: new Set(),
    repository,
    guildId,
    rateLimitGuard: guard,
  });
  const join = (userId, channelId = "lobby") =>
    service.handleJoin({ member: { id: userId, user: { username: `u-${userId}` } }, channelId });
  return { service, created, inserted, moved, join };
}

test("P6 tempvoice : 4 créations autorisées, 5e refusée sans salon ni DB", async () => {
  let now = 1_000_000;
  const guard = new ActionRateLimitGuard({ clock: () => now });
  const h = harness({ guard });

  for (let i = 1; i <= 4; i += 1) {
    const res = await h.join("u1");
    assert.equal(res.handled, true, `création ${i}/4 autorisée`);
    assert.equal(res.code, "TEMPVOICE_CREATED");
  }
  assert.equal(h.created.length, 4, "4 salons créés");
  assert.equal(h.inserted.length, 4, "4 écritures DB");

  const fifth = await h.join("u1");
  assert.equal(fifth.handled, false);
  assert.equal(fifth.code, "TEMPVOICE_RATE_LIMITED");
  assert.equal(h.created.length, 4, "AUCUNE création au refus");
  assert.equal(h.moved.length, 4, "AUCUN déplacement au refus (membre reste au lobby)");
  assert.equal(h.inserted.length, 4, "AUCUNE écriture DB au refus");
});

test("P6 tempvoice : une entrée qui ne crée pas de salon ne consomme rien", async () => {
  let now = 1_000_000;
  const guard = new ActionRateLimitGuard({ clock: () => now });
  const h = harness({ guard });

  // Rejoindre un salon qui n'est PAS le lobby (ex. une room existante) :
  // handleJoin n'est pas le chemin de création → aucun crédit consommé.
  for (let i = 0; i < 10; i += 1) {
    const res = await h.join("u1", "room-existante");
    assert.equal(res.code, "NOT_LOBBY");
  }
  assert.equal(h.created.length, 0);

  // Les 4 crédits de création sont toujours intacts.
  for (let i = 1; i <= 4; i += 1) {
    assert.equal((await h.join("u1")).handled, true, `crédit ${i} préservé`);
  }
  assert.equal((await h.join("u1")).code, "TEMPVOICE_RATE_LIMITED", "5e création refusée");
});

test("P6 tempvoice : isolation user et guild", async () => {
  let now = 1_000_000;
  const guard = new ActionRateLimitGuard({ clock: () => now });
  const h1 = harness({ guildId: "g1", guard });
  for (let i = 0; i < 4; i += 1) await h1.join("u1");
  assert.equal((await h1.join("u1")).code, "TEMPVOICE_RATE_LIMITED");

  assert.equal((await h1.join("u2")).handled, true, "user isolé");
  const h2 = harness({ guildId: "g2", guard });
  assert.equal((await h2.join("u1")).handled, true, "guild isolée (même garde partagé)");
});

test("P6 tempvoice : expiration 60 s", async () => {
  let now = 1_000_000;
  const guard = new ActionRateLimitGuard({ clock: () => now });
  const h = harness({ guard });
  for (let i = 0; i < 4; i += 1) await h.join("u1");
  assert.equal((await h.join("u1")).code, "TEMPVOICE_RATE_LIMITED");

  now += RATE_LIMITS.TEMPVOICE.windowMs + 1;
  assert.equal((await h.join("u1")).handled, true, "réarmé après 60 s");
});

test("P6 tempvoice : sans garde injecté, comportement historique inchangé", async () => {
  const h = harness({ guard: null });
  for (let i = 0; i < 6; i += 1) {
    const res = await h.join("u1");
    assert.equal(res.handled, true, `création ${i + 1} sans limite (service unitaire sans garde)`);
  }
  assert.equal(h.created.length, 6);
});
