"use strict";

/**
 * P6 §10 — tests de l'utilitaire `ActionRateLimitGuard`.
 *
 * Verrouille : sous-seuil, seuil exact, dépassement, expiration de fenêtre,
 * reset/clear, isolations user / guild / group, clés invalides (impossible de
 * partager une clé), temps restant exact, clock injectable, non-collision de
 * groupes, absence de timer global, plafond mémoire.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  ActionRateLimitGuard,
  RATE_LIMITS,
  sharedRateLimitGuard,
} = require("../ActionRateLimitGuard");

function harness(options = {}) {
  let now = 1_000_000;
  const guard = new ActionRateLimitGuard({ clock: () => now, ...options });
  return {
    guard,
    tick: (ms) => { now += ms; },
    now: () => now,
  };
}

const LIMIT = { group: "g", limit: 3, windowMs: 60000 };

test("P6 défauts : limites exactes et groupes distincts", () => {
  assert.equal(RATE_LIMITS.SUGGEST.limit, 3);
  assert.equal(RATE_LIMITS.SUGGEST.windowMs, 600000);
  assert.equal(RATE_LIMITS.SUGGEST.group, "suggest");
  assert.equal(RATE_LIMITS.TEMPVOICE.limit, 4);
  assert.equal(RATE_LIMITS.TEMPVOICE.windowMs, 60000);
  assert.equal(RATE_LIMITS.WELCOME_IMAGE.limit, 5);
  assert.equal(RATE_LIMITS.WELCOME_IMAGE.windowMs, 300000);
  assert.equal(RATE_LIMITS.CONFIG.limit, 30);
  assert.equal(RATE_LIMITS.CONFIG.windowMs, 60000);
  const groups = Object.values(RATE_LIMITS).map((v) => v.group);
  assert.equal(new Set(groups).size, groups.length, "groupes uniques");
});

test("P6 guard : sous-seuil autorise, compte exact", () => {
  const { guard } = harness();
  for (let i = 1; i <= 2; i += 1) {
    const gate = guard.check({ guildId: "g1", userId: "u1", ...LIMIT });
    assert.equal(gate.allowed, true, `${i} autorisé`);
    assert.equal(gate.count, i - 1);
    assert.equal(gate.remaining, LIMIT.limit - (i - 1));
    guard.record({ guildId: "g1", userId: "u1", ...LIMIT });
  }
});

test("P6 guard : seuil exact puis dépassement, retryAfter exact", () => {
  const { guard, tick } = harness();
  for (let i = 0; i < 3; i += 1) {
    assert.equal(guard.check({ guildId: "g1", userId: "u1", ...LIMIT }).allowed, true);
    guard.record({ guildId: "g1", userId: "u1", ...LIMIT });
    tick(1000);
  }
  const refused = guard.check({ guildId: "g1", userId: "u1", ...LIMIT });
  assert.equal(refused.allowed, false, "4e refusée");
  assert.equal(refused.count, 3);
  assert.equal(refused.remaining, 0);
  // Premier crédit posé à t0, fenêtre 60 000 — il en reste 60 000 - 3 000.
  assert.equal(refused.retryAfterMs, 60000 - 3000);
  // Toujours refusé un instant après.
  tick(100);
  assert.equal(guard.check({ guildId: "g1", userId: "u1", ...LIMIT }).allowed, false);
});

test("P6 guard : expiration de fenêtre réarme complètement", () => {
  const { guard, tick } = harness();
  for (let i = 0; i < 3; i += 1) {
    guard.record({ guildId: "g1", userId: "u1", ...LIMIT });
    tick(10);
  }
  assert.equal(guard.check({ guildId: "g1", userId: "u1", ...LIMIT }).allowed, false);
  tick(60001);
  const after = guard.check({ guildId: "g1", userId: "u1", ...LIMIT });
  assert.equal(after.allowed, true, "réarmé après la fenêtre");
  assert.equal(after.count, 0, "compteur vidé (expiration lazy)");
  assert.equal(guard.size, 0, "clé entièrement purgée");
});

test("P6 guard : isolation user / guild / group stricte", () => {
  const { guard } = harness();
  for (let i = 0; i < 3; i += 1) guard.record({ guildId: "g1", userId: "u1", ...LIMIT });

  assert.equal(guard.check({ guildId: "g1", userId: "u2", ...LIMIT }).allowed, true, "user isolé");
  assert.equal(guard.check({ guildId: "g2", userId: "u1", ...LIMIT }).allowed, true, "guild isolée");
  assert.equal(guard.check({ guildId: "g1", userId: "u1", group: "other", limit: 3, windowMs: 60000 }).allowed, true, "group isolé");

  // Plusieurs groupes pour la même paire : aucun collision de compteur.
  guard.record({ guildId: "g1", userId: "u1", group: "other", limit: 3, windowMs: 60000 });
  assert.equal(guard.check({ guildId: "g1", userId: "u1", group: "other", limit: 3, windowMs: 60000 }).count, 1);
  assert.equal(guard.check({ guildId: "g1", userId: "u1", ...LIMIT }).count, 3, "compteurs indépendants");
});

test("P6 guard : clé incorrecte impossible à partager (TypeError)", () => {
  assert.throws(() => ActionRateLimitGuard.key("", "u1", "g"), /guildId/);
  assert.throws(() => ActionRateLimitGuard.key("g1", "", "g"), /userId/);
  assert.throws(() => ActionRateLimitGuard.key("g1", "u1", ""), /group/);
  assert.throws(() => ActionRateLimitGuard.key("g1", "u1"), /group/);
  assert.throws(() => ActionRateLimitGuard.key(null, "u1", "g"), /guildId/);
  const guard = new ActionRateLimitGuard();
  assert.throws(() => guard.check({ guildId: "g1", userId: "u1", group: "", limit: 3, windowMs: 1000 }), /group/);
  assert.throws(() => guard.check({ guildId: "g1", userId: "u1", group: "g", limit: 0, windowMs: 1000 }), /limit/);
  assert.throws(() => guard.check({ guildId: "g1", userId: "u1", group: "g", limit: 3, windowMs: -1 }), /windowMs/);
  assert.equal(guard.size, 0, "aucune clé fantôme créée");
});

test("P6 guard : clock injectable (constructeur strict)", () => {
  assert.throws(() => new ActionRateLimitGuard({ clock: "nope" }), /clock/);
  let now = 500;
  const guard = new ActionRateLimitGuard({ clock: () => now });
  guard.record({ guildId: "g1", userId: "u1", ...LIMIT });
  now += 60001;
  assert.equal(guard.check({ guildId: "g1", userId: "u1", ...LIMIT }).allowed, true, "horloge pilotée par le test");
});

test("P6 guard : reset d'une clé et clear complet", () => {
  const { guard } = harness();
  for (let i = 0; i < 3; i += 1) guard.record({ guildId: "g1", userId: "u1", ...LIMIT });
  guard.record({ guildId: "g1", userId: "u2", ...LIMIT });

  guard.reset({ guildId: "g1", userId: "u1", group: "g" });
  assert.equal(guard.check({ guildId: "g1", userId: "u1", ...LIMIT }).allowed, true, "clé réarmée");
  assert.equal(guard.check({ guildId: "g1", userId: "u2", ...LIMIT }).count, 1, "autre clé intacte");

  guard.clear();
  assert.equal(guard.size, 0, "clear vide tout");
  assert.equal(guard.check({ guildId: "g1", userId: "u2", ...LIMIT }).count, 0);
});

test("P6 guard : aucun timer global dans le module", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "ActionRateLimitGuard.js"), "utf8");
  assert.equal(/setInterval\s*\(/.test(source), false, "pas de setInterval");
  assert.equal(/setTimeout\s*\(/.test(source), false, "pas de setTimeout");
});

test("P6 guard : plafond mémoire borné (balayage + éviction)", () => {
  const { guard } = harness({ maxKeys: 5 });
  for (let i = 0; i < 20; i += 1) {
    guard.record({ guildId: `g${i}`, userId: "u1", ...LIMIT });
  }
  assert.ok(guard.size <= 5, `taille bornée (${guard.size})`);
  // La clé la plus ancienne a été évictée : elle repart de zéro.
  assert.equal(guard.check({ guildId: "g0", userId: "u1", ...LIMIT }).count, 0);
  // Les toutes dernières sont encore là.
  assert.equal(guard.check({ guildId: "g19", userId: "u1", ...LIMIT }).count, 1);
});

test("P6 guard : record au-delà de la limite reste cohérent", () => {
  const { guard } = harness();
  for (let i = 0; i < 5; i += 1) guard.record({ guildId: "g1", userId: "u1", ...LIMIT });
  const gate = guard.check({ guildId: "g1", userId: "u1", ...LIMIT });
  assert.equal(gate.allowed, false);
  assert.equal(gate.count, 5, "les crédits restent visibles");
  assert.ok(gate.retryAfterMs > 0);
});

test("P6 guard : l'instance partagée existe et est fonctionnelle", () => {
  assert.ok(sharedRateLimitGuard instanceof ActionRateLimitGuard);
  const probe = { guildId: "shared-probe-guild", userId: "shared-probe-user", group: "shared-probe", limit: 1, windowMs: 1 };
  assert.equal(sharedRateLimitGuard.check(probe).allowed, true);
  sharedRateLimitGuard.record(probe);
  assert.equal(sharedRateLimitGuard.check(probe).allowed, false);
  sharedRateLimitGuard.reset(probe);
});
