"use strict";

/**
 * P2-B — résolution contrôlée d'acteur sur plusieurs types d'audit
 * (`resolveAuditActorSequence`) avec le VRAI résolveur et de fausses guildes.
 *
 * Verrouille le contrat attribution de `channelUpdate` :
 *  • modification d'overwrite → essai des types 13/14/15 PUIS 11 en secours,
 *    arrêt à la première correspondance (jamais plusieurs résolutions) ;
 *  • les deux hypothèses de `target_id` sont couvertes : l'identifiant du salon
 *    d'abord, puis celui de l'overwrite réellement touché ;
 *  • garde de nature `isOverwriteChange` sur les types overwrite ;
 *  • fraîcheur (30 s), consommation unique, isolation par guild ;
 *  • indisponibilité / aucune correspondance → null partout (fail-closed),
 *    rien n'est jamais inventé.
 *
 * Le logger est stubbé (no-op) AVANT tout chargement de module pour éviter le
 * bruit des avertissements `AUDIT_LOG_READ_FAILED`.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..", "..", "..");

// ── Stub logger (no-op) installé avant tout chargement de module ────
const loggerKey = require.resolve(path.join(ROOT, "src/utils/logger.js"));
require.cache[loggerKey] = {
  id: loggerKey,
  filename: loggerKey,
  loaded: true,
  exports: { warn() {}, error() {}, info() {}, debug() {} },
  children: [],
  paths: [],
};

const { AuditLogEvent } = require("discord.js");
const { resolveAuditActorSequence, isOverwriteChange, _resetConsumed } = require("../../../utils/auditLogActor");
const { _clearCache } = require("../../../utils/auditLogCache");

// ── Doublures ───────────────────────────────────────────────────────

function auditEntry({ id, targetId, executorId, executorTag, createdAt, changes = [] }) {
  return {
    id,
    targetId,
    executor: executorId ? { id: executorId, tag: executorTag } : null,
    createdAt: new Date(createdAt),
    changes,
  };
}

/** Guilde qui sert des entrées DIFFÉRENTES par type d'audit, et compte les appels. */
function fakeGuild(id, byType) {
  const calls = [];
  return {
    id,
    calls,
    async fetchAuditLogs({ type } = {}) {
      calls.push(type);
      const value = byType[type];
      if (value instanceof Error) throw value;
      return { entries: value || [] };
    },
  };
}

const TYPES_13_14_15_11 = [
  { type: AuditLogEvent.ChannelOverwriteCreate, changeFilter: isOverwriteChange },
  { type: AuditLogEvent.ChannelOverwriteUpdate, changeFilter: isOverwriteChange },
  { type: AuditLogEvent.ChannelOverwriteDelete, changeFilter: isOverwriteChange },
  { type: AuditLogEvent.ChannelUpdate },
];

test.beforeEach(() => {
  _clearCache();
  _resetConsumed();
});

// ─────────────────────────────────────────────────────────────────────
// Correspondances happy-path
// ─────────────────────────────────────────────────────────────────────

test("P2B seq: entrée overwrite (14) visant le SALON → trouvée au premier type", async () => {
  const now = Date.now();
  const guild = fakeGuild("g1", {
    14: [auditEntry({ id: "e14", targetId: "c1", executorId: "u1", executorTag: "Alice#0001", createdAt: now, changes: [{ key: "allow", old: "0", new: "1024" }] })],
  });

  const actor = await resolveAuditActorSequence({
    guild,
    types: TYPES_13_14_15_11,
    targetIds: ["c1", "R9"],
  });

  assert.equal(actor.executorId, "u1");
  assert.equal(actor.executor, "Alice#0001 (u1)");
  assert.equal(actor.matchedType, AuditLogEvent.ChannelOverwriteUpdate);
  assert.equal(actor.matchedType, 14);
  assert.equal(actor.matchedTargetId, "c1");
  assert.deepEqual(guild.calls, [13, 14], "13 essayé puis 14 retenu — arrêt avant 15 et 11");
});

test("P2B seq: target_id = entité overwriteée (hypothèse doc) → trouvée sur la 2e cible candidate", async () => {
  const now = Date.now();
  const guild = fakeGuild("g1", {
    // L'entrée 13 porte l'ID de l'overwrite touché, pas celui du salon.
    13: [auditEntry({ id: "e13", targetId: "R9", executorId: "u2", executorTag: "Bob#0002", createdAt: now, changes: [{ key: "allow", old: "0", new: "16" }] })],
  });

  const actor = await resolveAuditActorSequence({
    guild,
    types: TYPES_13_14_15_11,
    targetIds: ["c1", "R9"],
  });

  assert.equal(actor.executorId, "u2");
  assert.equal(actor.matchedType, 13);
  assert.equal(actor.matchedTargetId, "R9", "candidat retenu = l'overwrite touché");
  assert.deepEqual(guild.calls, [13], "cache par type : une seule requête, deux candidats locaux");
});

test("P2B seq: aucun overwrite → secours type 11 (cas normal ChannelUpdate)", async () => {
  const now = Date.now();
  const guild = fakeGuild("g1", {
    13: [],
    14: [],
    15: [],
    11: [auditEntry({ id: "e11", targetId: "c1", executorId: "u3", executorTag: "Cara#0003", createdAt: now, changes: [{ key: "name", old: "a", new: "b" }] })],
  });

  const actor = await resolveAuditActorSequence({
    guild,
    types: TYPES_13_14_15_11,
    targetIds: ["c1"],
  });

  assert.equal(actor.executorId, "u3");
  assert.equal(actor.matchedType, 11);
  assert.deepEqual(guild.calls, [13, 14, 15, 11], "les types overwrite ont bien été essayés avant le secours 11");
});

test("P2B seq: le type prioritaire EST essayé en premier, jamais un autre ordre", async () => {
  const now = Date.now();
  const guild = fakeGuild("g1", {
    14: [auditEntry({ id: "e14", targetId: "c1", executorId: "u1", executorTag: "A#1", createdAt: now, changes: [{ key: "deny", old: "0", new: "1024" }] })],
    11: [auditEntry({ id: "e11", targetId: "c1", executorId: "uOTHER", executorTag: "OTHER#9", createdAt: now })],
  });

  const actor = await resolveAuditActorSequence({
    guild,
    types: [{ type: AuditLogEvent.ChannelOverwriteUpdate, changeFilter: isOverwriteChange }, { type: AuditLogEvent.ChannelUpdate }],
    targetIds: ["c1"],
  });

  assert.equal(actor.executorId, "u1", "l'évidence overwrite l'emporte sur le secours 11");
  assert.deepEqual(guild.calls, [14], "11 n'est même pas touché");
});

// ─────────────────────────────────────────────────────────────────────
// Garde de nature (changeFilter)
// ─────────────────────────────────────────────────────────────────────

test("P2B seq: changeFilter rejette une entrée overwrite sans allow/deny → secours puis fail-closed", async () => {
  const now = Date.now();
  const guild = fakeGuild("g1", {
    14: [auditEntry({ id: "eBad", targetId: "c1", executorId: "uX", executorTag: "X#1", createdAt: now, changes: [{ key: "name", old: "a", new: "b" }] })],
    13: [], 15: [], 11: [],
  });

  const actor = await resolveAuditActorSequence({ guild, types: TYPES_13_14_15_11, targetIds: ["c1"] });

  assert.equal(actor.executorId, null, "entrée de nature incorrecte non attribuée");
  assert.equal(actor.matchedType, null);
  assert.deepEqual(guild.calls, [13, 14, 15, 11], "chaque type essayé une fois malgré le rejet (ordre 13/14/15/11)");
});

test("isOverwriteChange: allow/deny acceptés, changes vide accepté (indéterminable), sans allow/deny rejeté", () => {
  assert.equal(isOverwriteChange({ changes: [{ key: "allow", new: "1" }] }), true);
  assert.equal(isOverwriteChange({ changes: [{ key: "deny", new: "1" }] }), true);
  assert.equal(isOverwriteChange({ changes: [] }), true, "nature indéterminable → la garde n'interdit rien");
  assert.equal(isOverwriteChange({}), true, "sans changes → accepté");
  assert.equal(isOverwriteChange({ changes: [{ key: "name", new: "x" }] }), false);
  assert.equal(isOverwriteChange(null), true);
});

// ─────────────────────────────────────────────────────────────────────
// Gardes : fraîcheur, consommation, indisponibilité, enveloppe
// ─────────────────────────────────────────────────────────────────────

test("P2B seq: entrée trop ancienne (> 30 s) → non attribuable, null", async () => {
  const guild = fakeGuild("g1", {
    14: [auditEntry({ id: "eOld", targetId: "c1", executorId: "u1", executorTag: "A#1", createdAt: Date.now() - 60_000, changes: [{ key: "allow", new: "1" }] })],
    11: [],
  });

  const actor = await resolveAuditActorSequence({ guild, types: TYPES_13_14_15_11, targetIds: ["c1"] });
  assert.equal(actor.executorId, null);
  assert.equal(actor.executor, null);
});

test("P2B seq: consommation unique — un second appel sur la même entrée → null", async () => {
  const now = Date.now();
  const guild = fakeGuild("g1", {
    14: [auditEntry({ id: "e1", targetId: "c1", executorId: "u1", executorTag: "A#1", createdAt: now, changes: [{ key: "allow", new: "1" }] })],
  });
  const types = [{ type: AuditLogEvent.ChannelOverwriteUpdate, changeFilter: isOverwriteChange }];

  const first = await resolveAuditActorSequence({ guild, types, targetIds: ["c1"] });
  assert.equal(first.executorId, "u1");

  const second = await resolveAuditActorSequence({ guild, types, targetIds: ["c1"] });
  assert.equal(second.executorId, null, "entrée déjà consommée : jamais réattribuée");
});

test("P2B seq: arrêt au premier match — l'entrée du type suivant reste NON consommée", async () => {
  const now = Date.now();
  const guild = fakeGuild("g1", {
    14: [auditEntry({ id: "e14", targetId: "c1", executorId: "u14", executorTag: "A#14", createdAt: now, changes: [{ key: "allow", new: "1" }] })],
    11: [auditEntry({ id: "e11", targetId: "c1", executorId: "u11", executorTag: "B#11", createdAt: now })],
  });

  const first = await resolveAuditActorSequence({ guild, types: TYPES_13_14_15_11, targetIds: ["c1"] });
  assert.equal(first.matchedType, 14);

  // Une résolution ultérieure (autre événement, type 11 seul) retrouve SON entrée :
  // la séquence n'a consommé que ce qu'elle a retenu.
  const { resolveAuditActor } = require("../../../utils/auditLogActor");
  const later = await resolveAuditActor({ guild, type: AuditLogEvent.ChannelUpdate, targetId: "c1" });
  assert.equal(later.executorId, "u11");
});

test("P2B seq: Audit Log indisponible (erreur) → null partout, fail-closed", async () => {
  const guild = fakeGuild("g1", { 14: new Error("Missing Permissions"), 11: new Error("Missing Permissions") });
  const actor = await resolveAuditActorSequence({ guild, types: TYPES_13_14_15_11, targetIds: ["c1"] });
  assert.equal(actor.executorId, null);
  assert.equal(actor.executor, null);
  assert.equal(actor.matchedType, null);
});

test("P2B seq: enveloppe vide (types/cibles/cible absents) → null SANS appel API", async () => {
  const guild = fakeGuild("g1", {});
  assert.equal((await resolveAuditActorSequence({ guild, types: [], targetIds: ["c1"] })).executorId, null);
  assert.equal((await resolveAuditActorSequence({ guild, types: [14], targetIds: [] })).executorId, null);
  assert.equal((await resolveAuditActorSequence({ guild: null, types: [14], targetIds: ["c1"] })).executorId, null);
  assert.equal((await resolveAuditActorSequence({ guild, types: [14] })).executorId, null);
  assert.deepEqual(guild.calls, [], "aucun appel API sur enveloppe invalide");
});

test("P2B seq: entrée sans exécuteur → champs null, jamais d'identité inventée", async () => {
  const now = Date.now();
  const guild = fakeGuild("g1", {
    14: [auditEntry({ id: "e1", targetId: "c1", executorId: null, createdAt: now, changes: [{ key: "allow", new: "1" }] })],
  });
  const actor = await resolveAuditActorSequence({
    guild,
    types: [{ type: AuditLogEvent.ChannelOverwriteUpdate, changeFilter: isOverwriteChange }],
    targetIds: ["c1"],
  });
  assert.equal(actor.executorId, null);
  assert.equal(actor.executor, null);
  assert.equal(actor.matchedType, 14, "l'entrée est bien retenue, sans exécuteur identifiable");
});

test("P2B seq: isolation par guild — une entrée consommée sur g1 ne bloque pas g2", async () => {
  const now = Date.now();
  const entry = () => auditEntry({ id: "e1", targetId: "c1", executorId: "u1", executorTag: "A#1", createdAt: now, changes: [{ key: "allow", new: "1" }] });
  const types = [{ type: AuditLogEvent.ChannelOverwriteUpdate, changeFilter: isOverwriteChange }];

  const g1 = fakeGuild("g1", { 14: [entry()] });
  const g2 = fakeGuild("g2", { 14: [entry()] });

  const first = await resolveAuditActorSequence({ guild: g1, types, targetIds: ["c1"] });
  assert.equal(first.executorId, "u1");

  const second = await resolveAuditActorSequence({ guild: g2, types, targetIds: ["c1"] });
  assert.equal(second.executorId, "u1", "le registre de consommation est cloisonné par guild_id");
});
