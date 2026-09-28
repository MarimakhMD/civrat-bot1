"use strict";

/**
 * PHASE 1 (correctif 2) — la fenêtre de corrélation élargie ne réintroduit PAS
 * l'ancien faux kick.
 *
 * `CLOCK_SKEW_MS` est passée de 10 s à 60 s pour survivre à une dérive d'horloge
 * du conteneur. Cette tolérance borne le côté FUTUR (une entrée peut porter un
 * horodatage légèrement postérieur à l'événement). La protection contre la
 * réutilisation d'une ancienne action repose sur `MAX_ENTRY_AGE_MS`, côté PASSÉ,
 * inchangée à 30 s, et sur le registre d'entrées consommées.
 *
 * Ces tests verrouillent explicitement cette asymétrie : élargir le futur ne
 * doit jamais rendre attribuable une entrée ancienne.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  resolveAuditAction,
  isFresh,
  AuditLogEventType,
  MAX_ENTRY_AGE_MS,
  CLOCK_SKEW_MS,
  _resetConsumed,
} = require("../../src/utils/auditLogActor");
const { _clearCache } = require("../../src/utils/auditLogCache");

function makeGuild(guildId, entries) {
  const state = { calls: 0 };
  return {
    id: guildId,
    state,
    fetchAuditLogs: async () => {
      state.calls += 1;
      return { entries: { filter: () => entries } };
    },
  };
}

function kickEntry({ id, memberId, ageMs, executor = { id: "mod1", tag: "Moderator" }, reason = "spam" }) {
  return {
    id,
    actionType: AuditLogEventType.MEMBER_KICK,
    target: { id: memberId },
    executor,
    reason,
    createdAt: new Date(Date.now() - ageMs),
  };
}

function beforeEachReset() {
  _clearCache();
  _resetConsumed();
}

test("PHASE1-FIX2: la tolérance d'horloge est asymétrique par conception", () => {
  assert.equal(CLOCK_SKEW_MS, 60_000, "côté futur : tolérance à la dérive d'horloge");
  assert.equal(MAX_ENTRY_AGE_MS, 30_000, "côté passé : borne anti-réutilisation, inchangée");
});

test("PHASE1-FIX2: un ancien MemberKick (5 min) n'est PAS réattribuable", async () => {
  beforeEachReset();
  const guild = makeGuild("G1", [kickEntry({ id: "K_OLD", memberId: "u1", ageMs: 5 * 60_000 })]);

  const result = await resolveAuditAction({
    guild,
    type: AuditLogEventType.MEMBER_KICK,
    targetId: "u1",
    occurredAt: Date.now(),
  });

  assert.equal(result.matched, false, "une entrée de 5 min ne peut pas expliquer un départ présent");
  assert.equal(result.executor, null, "aucun modérateur n'est réattribué");
  assert.equal(result.reason, null, "aucune raison n'est réattribuée");
});

test("PHASE1-FIX2: un MemberKick de 31 s n'est PAS réattribuable (borne passée intacte)", async () => {
  beforeEachReset();
  const guild = makeGuild("G1", [kickEntry({ id: "K_31", memberId: "u1", ageMs: MAX_ENTRY_AGE_MS + 1_000 })]);

  const result = await resolveAuditAction({
    guild,
    type: AuditLogEventType.MEMBER_KICK,
    targetId: "u1",
    occurredAt: Date.now(),
  });

  assert.equal(result.matched, false);
});

test("PHASE1-FIX2: un MemberKick contemporain reste attribuable", async () => {
  beforeEachReset();
  const guild = makeGuild("G1", [kickEntry({ id: "K_NOW", memberId: "u1", ageMs: 2_000 })]);

  const result = await resolveAuditAction({
    guild,
    type: AuditLogEventType.MEMBER_KICK,
    targetId: "u1",
    occurredAt: Date.now(),
  });

  assert.equal(result.matched, true);
  assert.equal(result.executor, "Moderator (mod1)");
  assert.equal(result.reason, "spam");
});

test("PHASE1-FIX2: élargir le futur ne rend attribuable aucune entrée ancienne", async () => {
  // Balayage : quelle que soit la tolérance côté futur, une entrée ancienne
  // reste rejetée — la garde qui protège est `MAX_ENTRY_AGE_MS`.
  for (const ageMs of [31_000, 60_000, 120_000, 10 * 60_000, 60 * 60_000]) {
    beforeEachReset();
    const guild = makeGuild("G1", [kickEntry({ id: `K_${ageMs}`, memberId: "u1", ageMs })]);
    const result = await resolveAuditAction({
      guild,
      type: AuditLogEventType.MEMBER_KICK,
      targetId: "u1",
      occurredAt: Date.now(),
    });
    assert.equal(result.matched, false, `une entrée de ${ageMs} ms ne doit jamais être attribuée`);
  }
});

test("PHASE1-FIX2: la garde de fraîcheur reste active au-delà de la tolérance future", () => {
  const now = Date.now();
  assert.equal(isFresh({ createdAt: new Date(now + CLOCK_SKEW_MS) }, now), true);
  assert.equal(isFresh({ createdAt: new Date(now + CLOCK_SKEW_MS + 1) }, now), false);
  assert.equal(isFresh({ createdAt: new Date(now + 10 * 60_000) }, now), false);
});

test("PHASE1-FIX2: une entrée consommée ne peut pas être réattribuée", async () => {
  beforeEachReset();
  const guild = makeGuild("G1", [kickEntry({ id: "K_ONCE", memberId: "u1", ageMs: 1_000 })]);

  const first = await resolveAuditAction({
    guild,
    type: AuditLogEventType.MEMBER_KICK,
    targetId: "u1",
    occurredAt: Date.now(),
  });
  const second = await resolveAuditAction({
    guild,
    type: AuditLogEventType.MEMBER_KICK,
    targetId: "u1",
    occurredAt: Date.now(),
  });

  assert.equal(first.matched, true);
  assert.equal(second.matched, false, "kick → retour → départ volontaire ne doit rejouer ni le kick ni son auteur");
  assert.equal(second.executor, null);
});

test("PHASE1-FIX2: l'attribution reste isolée par guild_id", async () => {
  beforeEachReset();
  const guildA = makeGuild("GA", [kickEntry({ id: "KA", memberId: "u1", ageMs: 1_000 })]);
  const guildB = makeGuild("GB", []);

  const a = await resolveAuditAction({ guild: guildA, type: AuditLogEventType.MEMBER_KICK, targetId: "u1", occurredAt: Date.now() });
  const b = await resolveAuditAction({ guild: guildB, type: AuditLogEventType.MEMBER_KICK, targetId: "u1", occurredAt: Date.now() });

  assert.equal(a.matched, true);
  assert.equal(b.matched, false, "une entrée d'un autre serveur ne peut pas être attribuée");
});
