"use strict";

/**
 * PHASE 1 — tests de comportement de la corrélation Audit Log.
 *
 * Chaque test rejoue un scénario réel qui produisait un log faux, perdu ou
 * dupliqué avant la Phase 1. Les fixtures fournissent `createdAt` et `id`
 * comme le fait Discord : ce sont précisément ces deux champs que les nouvelles
 * gardes (fraîcheur + consommation) exploitent.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  resolveAuditAction,
  resolveAuditActor,
  resolveTimeoutAction,
  resolveRoleDelta,
  resolveRoleDeltas,
  isTimeoutEntry,
  isUntimeoutEntry,
  matchesTarget,
  isFresh,
  AuditLogEventType,
  MAX_ENTRY_AGE_MS,
  CLOCK_SKEW_MS,
  _resetConsumed,
} = require("../auditLogActor");
const { _clearCache } = require("../auditLogCache");

const DAY_MS = 24 * 60 * 60 * 1000;

/** Guilde de test : `fetchAuditLogs` rend les entrées fournies, de la plus récente à la plus ancienne. */
function makeGuild(guildId, entries, { delayMs = 0 } = {}) {
  const state = { calls: 0 };
  return {
    id: guildId,
    state,
    fetchAuditLogs: async ({ type, limit }) => {
      state.calls += 1;
      state.lastType = type;
      state.lastLimit = limit;
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      const list = entries.filter((entry) => entry.__type === undefined || entry.__type === type);
      return { entries: { filter: () => list.slice(0, limit) } };
    },
  };
}

function reset() {
  _clearCache();
  _resetConsumed();
}

// ─────────────────────────────────────────────────────────────
// 1. Ancien kick + retour + départ volontaire
// ─────────────────────────────────────────────────────────────

test("PHASE1: un MemberKick vieux de plusieurs jours n'est jamais attribué à un départ", async () => {
  reset();
  const guild = makeGuild("g-old-kick", [
    {
      id: "E-OLD",
      target: { id: "U1" },
      executor: { id: "M1", tag: "Modo" },
      reason: "spam d'il y a trois jours",
      createdAt: new Date(Date.now() - 3 * DAY_MS),
    },
  ]);

  const action = await resolveAuditAction({ guild, type: AuditLogEventType.MEMBER_KICK, targetId: "U1" });
  assert.equal(action.matched, false, "l'entrée est hors fenêtre : rien ne doit être attribué");
  assert.equal(action.executor, null);
  assert.equal(action.reason, null, "l'ancienne raison ne doit pas resservir");
});

test("PHASE1: kick réel attribué une fois, puis départ volontaire non requalifié en kick", async () => {
  reset();
  const now = Date.now();
  const guild = makeGuild("g-kick-then-leave", [
    {
      id: "E-KICK",
      target: { id: "U1" },
      executor: { id: "M1", tag: "Modo" },
      reason: "insultes",
      createdAt: new Date(now),
    },
  ]);

  // 1er départ : le kick est réel → attribué.
  const first = await resolveAuditAction({ guild, type: AuditLogEventType.MEMBER_KICK, targetId: "U1", occurredAt: now });
  assert.equal(first.matched, true);
  assert.equal(first.executor, "Modo (M1)");
  assert.equal(first.reason, "insultes");

  // Le membre revient, puis part volontairement. L'entrée de kick existe
  // toujours dans l'audit, mais elle a déjà été consommée : le second départ
  // ne peut PAS être requalifié en expulsion.
  const second = await resolveAuditAction({ guild, type: AuditLogEventType.MEMBER_KICK, targetId: "U1", occurredAt: now + 60_000 });
  assert.equal(second.matched, false, "l'entrée consommée ne doit plus être réattribuée");
});

test("PHASE1: une entrée de kick visant un AUTRE membre n'est jamais attribuée", async () => {
  reset();
  const guild = makeGuild("g-other-target", [
    { id: "E-X", target: { id: "AUTRE" }, executor: { id: "M1", tag: "Modo" }, reason: "x", createdAt: new Date() },
  ]);
  const action = await resolveAuditAction({ guild, type: AuditLogEventType.MEMBER_KICK, targetId: "U1" });
  assert.equal(action.matched, false);
});

// ─────────────────────────────────────────────────────────────
// 2. Timeout vs pseudo — MemberUpdate est polymorphe
// ─────────────────────────────────────────────────────────────

const NICK_ENTRY = {
  id: "E-NICK",
  target: { id: "U1" },
  executor: { id: "M9", tag: "Renommeur" },
  reason: "pseudo non conforme",
  changes: [{ key: "nick", old: "alice", new: "Alice" }],
  createdAt: new Date(),
};

const TIMEOUT_ENTRY = {
  id: "E-TIMEOUT",
  target: { id: "U1" },
  executor: { id: "M1", tag: "Modo" },
  reason: "spam",
  changes: [{ key: "communication_disabled_until", old: null, new: "2030-01-01T00:00:00.000Z" }],
  createdAt: new Date(),
};

const UNTIMEOUT_ENTRY = {
  id: "E-UNTIMEOUT",
  target: { id: "U1" },
  executor: { id: "M2", tag: "Admin" },
  reason: "excuses acceptées",
  changes: [{ key: "communication_disabled_until", old: "2030-01-01T00:00:00.000Z", new: null }],
  createdAt: new Date(),
};

test("PHASE1: pseudo puis timeout — le timeout n'hérite ni de l'auteur ni de la raison du renommage", async () => {
  reset();
  // Ordre Discord : le PLUS RÉCENT en premier. Le renommage est postérieur au
  // timeout : sans filtre sur `changes`, c'est lui qui serait attribué.
  const guild = makeGuild("g-nick-then-timeout", [NICK_ENTRY, TIMEOUT_ENTRY]);

  const action = await resolveTimeoutAction({ guild, memberId: "U1", action: "member_timed_out" });
  assert.equal(action.matched, true);
  assert.equal(action.executor, "Modo (M1)", "l'auteur du timeout, pas celui du renommage");
  assert.equal(action.reason, "spam", "la raison du timeout, pas celle du renommage");
  assert.equal(action.entry.id, "E-TIMEOUT");
});

test("PHASE1: un untimeout n'accepte que l'entrée levant réellement le timeout", async () => {
  reset();
  const guild = makeGuild("g-untimeout", [NICK_ENTRY, UNTIMEOUT_ENTRY, TIMEOUT_ENTRY]);
  const action = await resolveTimeoutAction({ guild, memberId: "U1", action: "member_untimeout" });
  assert.equal(action.matched, true);
  assert.equal(action.entry.id, "E-UNTIMEOUT");
  assert.equal(action.executor, "Admin (M2)");
  assert.equal(action.reason, "excuses acceptées");
});

test("PHASE1: sans entrée portant communication_disabled_until, aucun acteur n'est inventé", async () => {
  reset();
  const guild = makeGuild("g-nick-only", [NICK_ENTRY]);
  const action = await resolveTimeoutAction({ guild, memberId: "U1", action: "member_timed_out" });
  assert.equal(action.matched, false);
  assert.equal(action.executor, null);
  assert.equal(action.reason, null);
});

test("PHASE1: isTimeoutEntry / isUntimeoutEntry distinguent pose et levée", () => {
  assert.equal(isTimeoutEntry(TIMEOUT_ENTRY), true);
  assert.equal(isTimeoutEntry(UNTIMEOUT_ENTRY), false);
  assert.equal(isTimeoutEntry(NICK_ENTRY), false);
  assert.equal(isUntimeoutEntry(UNTIMEOUT_ENTRY), true);
  assert.equal(isUntimeoutEntry(TIMEOUT_ENTRY), false);
  assert.equal(isUntimeoutEntry({ changes: null }), false);
});

// ─────────────────────────────────────────────────────────────
// 3. Rôles — concurrence et changements rapprochés
// ─────────────────────────────────────────────────────────────

function roleEntry(id, targetId, added, removed, executorTag, createdAt = new Date()) {
  const changes = [];
  if (added.length) changes.push({ key: "$add", new: added });
  if (removed.length) changes.push({ key: "$remove", new: removed });
  return { id, target: { id: targetId }, executor: { id: `M-${executorTag}`, tag: executorTag }, reason: null, changes, createdAt };
}

test("PHASE1: deux membres modifiés dans la même fenêtre reçoivent chacun leur delta", async () => {
  reset();
  const guild = makeGuild("g-two-members", [
    roleEntry("E-U1", "U1", [{ id: "R1", name: "Membre" }], [], "Modo"),
    roleEntry("E-U2", "U2", [{ id: "R2", name: "VIP" }], [], "Admin"),
  ]);

  const first = await resolveRoleDeltas({ guild, type: AuditLogEventType.MEMBER_ROLE_UPDATE, memberId: "U1" });
  const second = await resolveRoleDeltas({ guild, type: AuditLogEventType.MEMBER_ROLE_UPDATE, memberId: "U2" });

  assert.equal(first.length, 1, "le premier membre n'est plus écrasé par le cache limit:1");
  assert.deepEqual(first[0].addedRoles, [{ id: "R1", name: "Membre" }]);
  assert.equal(first[0].executor, "Modo (M-Modo)");

  assert.equal(second.length, 1, "le second membre n'est plus perdu");
  assert.deepEqual(second[0].addedRoles, [{ id: "R2", name: "VIP" }]);
  assert.equal(second[0].executor, "Admin (M-Admin)");
});

test("PHASE1: deux changements rapprochés du même membre donnent deux deltas séparés", async () => {
  reset();
  const older = new Date(Date.now() - 4_000);
  const newer = new Date(Date.now() - 2_000);
  const guild = makeGuild("g-two-changes", [
    roleEntry("E-SECOND", "U1", [{ id: "R2", name: "VIP" }], [], "Admin", newer),
    roleEntry("E-FIRST", "U1", [{ id: "R1", name: "Membre" }], [], "Modo", older),
  ]);

  const deltas = await resolveRoleDeltas({ guild, type: AuditLogEventType.MEMBER_ROLE_UPDATE, memberId: "U1" });
  assert.equal(deltas.length, 2, "un log par modification réelle");
  assert.deepEqual(deltas[0].addedRoles, [{ id: "R1", name: "Membre" }], "ordre chronologique : le plus ancien d'abord");
  assert.deepEqual(deltas[1].addedRoles, [{ id: "R2", name: "VIP" }]);

  const replay = await resolveRoleDeltas({ guild, type: AuditLogEventType.MEMBER_ROLE_UPDATE, memberId: "U1" });
  assert.deepEqual(replay, [], "les entrées consommées ne sont pas rejouées");
});

test("PHASE1: un delta indéterminable ne produit rien (aucun rôle inventé)", async () => {
  reset();
  const guild = makeGuild("g-no-delta", [
    { id: "E-EMPTY", target: { id: "U1" }, executor: { id: "M1", tag: "Modo" }, changes: [], createdAt: new Date() },
  ]);
  const deltas = await resolveRoleDeltas({ guild, type: AuditLogEventType.MEMBER_ROLE_UPDATE, memberId: "U1" });
  assert.deepEqual(deltas, []);

  const single = await resolveRoleDelta({ guild, type: AuditLogEventType.MEMBER_ROLE_UPDATE, memberId: "U1" });
  assert.deepEqual(single.addedRoles, []);
  assert.deepEqual(single.removedRoles, []);
});

test("PHASE1: retrait d'un rôle — le delta porte le vrai rôle retiré", async () => {
  reset();
  const guild = makeGuild("g-remove-role", [
    roleEntry("E-REM", "U1", [], [{ id: "R9", name: "Ancien" }], "Modo"),
  ]);
  const deltas = await resolveRoleDeltas({ guild, type: AuditLogEventType.MEMBER_ROLE_UPDATE, memberId: "U1" });
  assert.equal(deltas.length, 1);
  assert.deepEqual(deltas[0].removedRoles, [{ id: "R9", name: "Ancien" }]);
  assert.deepEqual(deltas[0].addedRoles, []);
});

// ─────────────────────────────────────────────────────────────
// 4. Appels Audit Log concurrents
// ─────────────────────────────────────────────────────────────

test("PHASE1: plusieurs résolutions simultanées partagent UNE seule requête API", async () => {
  reset();
  const guild = makeGuild("g-concurrent", [
    roleEntry("E-A", "U1", [{ id: "R1", name: "A" }], [], "Modo"),
    roleEntry("E-B", "U2", [{ id: "R2", name: "B" }], [], "Modo"),
    roleEntry("E-C", "U3", [{ id: "R3", name: "C" }], [], "Modo"),
  ], { delayMs: 20 });

  const results = await Promise.all([
    resolveRoleDeltas({ guild, type: AuditLogEventType.MEMBER_ROLE_UPDATE, memberId: "U1" }),
    resolveRoleDeltas({ guild, type: AuditLogEventType.MEMBER_ROLE_UPDATE, memberId: "U2" }),
    resolveRoleDeltas({ guild, type: AuditLogEventType.MEMBER_ROLE_UPDATE, memberId: "U3" }),
    resolveAuditActor({ guild, type: AuditLogEventType.MEMBER_ROLE_UPDATE, targetId: "U1" }),
  ]);

  assert.equal(guild.state.calls, 1, "une seule requête API pour quatre résolutions simultanées");
  assert.equal(results[0].length, 1);
  assert.equal(results[1].length, 1);
  assert.equal(results[2].length, 1);
});

test("PHASE1: la lecture se fait par lot, plus en limit:1", async () => {
  reset();
  const guild = makeGuild("g-batch", [roleEntry("E-A", "U1", [{ id: "R1", name: "A" }], [], "Modo")]);
  await resolveAuditActor({ guild, type: AuditLogEventType.MEMBER_ROLE_UPDATE, targetId: "U1" });
  assert.ok(guild.state.lastLimit > 1, `limit attendu > 1, obtenu ${guild.state.lastLimit}`);
});

// ─────────────────────────────────────────────────────────────
// 5. Gardes unitaires
// ─────────────────────────────────────────────────────────────

test("PHASE1: isFresh borne l'âge dans les deux sens", () => {
  const now = Date.now();
  assert.equal(isFresh({ createdAt: new Date(now) }, now), true);
  assert.equal(isFresh({ createdAt: new Date(now - MAX_ENTRY_AGE_MS - 1) }, now), false, "trop ancien");
  assert.equal(isFresh({ createdAt: new Date(now - MAX_ENTRY_AGE_MS + 1) }, now), true, "juste dans la fenêtre passée");
  // Correctif 2 — la tolérance d'horloge côté FUTUR est passée de 10 s à 60 s
  // (dérive du conteneur sans NTP). Les deux bornes sont vérifiées : la garde
  // reste active au-delà, elle n'a pas été supprimée.
  assert.equal(isFresh({ createdAt: new Date(now + CLOCK_SKEW_MS) }, now), true, "limite de tolérance acceptée");
  assert.equal(isFresh({ createdAt: new Date(now + CLOCK_SKEW_MS + 1) }, now), false, "trop récent (horloge décalée)");
  assert.equal(isFresh({ target: { id: "X" } }, now), true, "entrée sans horodatage : garde inapplicable");
});

test("PHASE1: matchesTarget exige une cible, par id ou par code", () => {
  assert.equal(matchesTarget({ target: { id: "U1" } }, "U1", null), true);
  assert.equal(matchesTarget({ target: { id: "U2" } }, "U1", null), false);
  assert.equal(matchesTarget({ target: { code: "abc" } }, null, "abc"), true);
  assert.equal(matchesTarget({ target: { code: "xyz" } }, null, "abc"), false);
  assert.equal(matchesTarget({ target: { id: "U1" } }, null, null), false, "sans cible, rien n'est attribuable");
  assert.equal(matchesTarget(null, "U1", null), false);
});

test("PHASE1: les constantes AuditLogEventType sont alignées sur discord.js", () => {
  const { AuditLogEvent } = require("discord.js");
  for (const [name, value] of Object.entries(AuditLogEventType)) {
    // MEMBER_ROLE_UPDATE → MemberRoleUpdate
    const discordName = name.toLowerCase().replace(/(^|_)(\w)/g, (_m, _sep, char) => char.toUpperCase());
    assert.equal(AuditLogEvent[discordName], value, `AuditLogEventType.${name} doit valoir AuditLogEvent.${discordName}`);
  }
});
