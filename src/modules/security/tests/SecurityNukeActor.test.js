"use strict";

/**
 * P2-A — identification de l'auteur d'un nuke.
 *
 * Deux niveaux sont verrouillés ici :
 *
 *  1. RÉSOLUTION (vrai `resolveAuditActor`, fausse guilde) — acteur trouvé /
 *     introuvable / Audit Log indisponible / entrée trop ancienne / plusieurs
 *     actions / consommation. C'est la brique que l'événement appelle UNE fois.
 *
 *  2. ALERTE (vrai `createSecurityRuntime`) — le payload nuke porte
 *     `actorId`/`actor`/`targetId`/`target`, fail-closed quand l'acteur est
 *     introuvable, suppression par `(guild, action)` — pas par acteur — et
 *     rétrocompatibilité de la signature `(obj)` sans acteur.
 *
 * Le logger est stubbé (no-op) pour éviter le bruit console des avertissements
 * d'échec de lecture d'Audit Log ; il faut l'installer AVANT de charger les
 * modules qui le requièrent (`auditLogCache`, `createSecurityRuntime`).
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
const { resolveAuditActor, _resetConsumed } = require("../../../utils/auditLogActor");
const { _clearCache } = require("../../../utils/auditLogCache");
const { createSecurityRuntime } = require("../runtime/createSecurityRuntime");

// ─────────────────────────────────────────────────────────────
// Niveau 1 — vraie résolution d'Audit Log
// ─────────────────────────────────────────────────────────────

function auditEntry({ id, targetId, executorId, executorTag, createdAt }) {
  return {
    id,
    targetId,
    executor: executorId ? { id: executorId, tag: executorTag } : null,
    createdAt: new Date(createdAt),
    changes: [],
  };
}

// `readAuditLog` appelle `guild.fetchAuditLogs({ type, limit })` et normalise
// `{ entries }` (un tableau est accepté tel quel par `toEntryArray`).
function fakeGuild(id, entriesOrError) {
  return {
    id,
    async fetchAuditLogs() {
      if (entriesOrError instanceof Error) throw entriesOrError;
      return { entries: entriesOrError };
    },
  };
}

test("résolution: acteur trouvé → executorId + libellé executor", async () => {
  _clearCache();
  _resetConsumed();
  const guild = fakeGuild("g1", [
    auditEntry({ id: "e1", targetId: "c1", executorId: "u1", executorTag: "Alice#0001", createdAt: Date.now() }),
  ]);
  const actor = await resolveAuditActor({ guild, type: AuditLogEvent.ChannelCreate, targetId: "c1" });
  assert.equal(actor.executorId, "u1");
  assert.equal(actor.executor, "Alice#0001 (u1)");
});

test("résolution: acteur introuvable (cible différente) → null, rien d'inventé", async () => {
  _clearCache();
  _resetConsumed();
  const guild = fakeGuild("g1", [
    auditEntry({ id: "e1", targetId: "OTHER", executorId: "u1", executorTag: "Alice#0001", createdAt: Date.now() }),
  ]);
  const actor = await resolveAuditActor({ guild, type: AuditLogEvent.ChannelCreate, targetId: "c1" });
  assert.equal(actor.executorId, null);
  assert.equal(actor.executor, null);
});

test("résolution: Audit Log indisponible (fetch en erreur) → null, fail-closed", async () => {
  _clearCache();
  _resetConsumed();
  const guild = fakeGuild("g1", new Error("Missing Permissions"));
  const actor = await resolveAuditActor({ guild, type: AuditLogEvent.ChannelCreate, targetId: "c1" });
  assert.equal(actor.executorId, null);
  assert.equal(actor.executor, null);
});

test("résolution: entrée trop ancienne (> 30 s) → non attributable, null", async () => {
  _clearCache();
  _resetConsumed();
  const guild = fakeGuild("g1", [
    auditEntry({ id: "e1", targetId: "c1", executorId: "u1", executorTag: "Alice#0001", createdAt: Date.now() - 60_000 }),
  ]);
  const actor = await resolveAuditActor({ guild, type: AuditLogEvent.ChannelCreate, targetId: "c1" });
  assert.equal(actor.executorId, null);
  assert.equal(actor.executor, null);
});

test("résolution: plusieurs actions → seule l'entrée de la cible est attribuée", async () => {
  _clearCache();
  _resetConsumed();
  const now = Date.now();
  const guild = fakeGuild("g1", [
    // La plus récente vise une AUTRE cible : ne doit pas être attribuée.
    auditEntry({ id: "eNew", targetId: "cOther", executorId: "uX", executorTag: "X#9999", createdAt: now }),
    // L'entrée qui vise vraiment c1, légèrement plus ancienne.
    auditEntry({ id: "eMatch", targetId: "c1", executorId: "u1", executorTag: "Alice#0001", createdAt: now - 100 }),
  ]);
  const actor = await resolveAuditActor({ guild, type: AuditLogEvent.ChannelCreate, targetId: "c1" });
  assert.equal(actor.executorId, "u1");
  assert.equal(actor.executor, "Alice#0001 (u1)");
});

test("résolution: consommation — un second resolve de la même entrée → null", async () => {
  _clearCache();
  _resetConsumed();
  const guild = fakeGuild("g1", [
    auditEntry({ id: "e1", targetId: "c1", executorId: "u1", executorTag: "Alice#0001", createdAt: Date.now() }),
  ]);
  const first = await resolveAuditActor({ guild, type: AuditLogEvent.ChannelCreate, targetId: "c1" });
  assert.equal(first.executorId, "u1");
  // C'est exactement le conflit Logs/Security : sans partage, le second resolve
  // (Security) ne retrouverait plus l'entrée déjà consommée par les Logs.
  const second = await resolveAuditActor({ guild, type: AuditLogEvent.ChannelCreate, targetId: "c1" });
  assert.equal(second.executorId, null);
  assert.equal(second.executor, null);
});

// ─────────────────────────────────────────────────────────────
// Niveau 2 — payload d'alerte nuke
// ─────────────────────────────────────────────────────────────

function makeRuntime(logs) {
  return createSecurityRuntime({
    configService: { read: async () => ({ security_enabled: true, security_anti_nuke: true }) },
    logsRuntimeFactory: () => ({ disabled: false, handleModerationEvent: async (e) => logs.push(e) }),
  });
}

test("alerte nuke: acteur résolu → actorId/actor/targetId/target renseignés", async () => {
  const logs = [];
  const runtime = makeRuntime(logs);
  const actor = { executor: "Alice#0001 (u1)", executorId: "u1", reason: null };
  for (let i = 0; i < 9; i++) {
    await runtime.handleChannelCreate({ id: `c${i}`, name: `chan${i}`, guild: { id: "g1" } }, actor);
  }
  const res = await runtime.handleChannelCreate({ id: "cFinal", name: "general", guild: { id: "g1" } }, actor);

  assert.equal(res.nuke.isNuke, true);
  assert.equal(logs.length, 1);
  const alert = logs[0];
  assert.equal(alert.action, "security_nuke");
  assert.equal(alert.subtype, "channelCreate");
  assert.equal(alert.actorId, "u1");
  assert.equal(alert.actor, "Alice#0001 (u1)");
  assert.equal(alert.targetId, "cFinal");
  assert.equal(alert.target, "#general (cFinal)");
  assert.equal(alert.rule, "SECURITY_NUKE_CHANNEL_CREATE");
});

test("alerte nuke: acteur introuvable → actorId/actor null (fail-closed), targetId présent", async () => {
  const logs = [];
  const runtime = makeRuntime(logs);
  const actor = { executor: null, executorId: null, reason: null };
  for (let i = 0; i < 11; i++) {
    await runtime.handleChannelDelete({ id: `c${i}`, name: `x${i}`, guild: { id: "g2" } }, actor);
  }
  const res = await runtime.handleChannelDelete({ id: "cBoom", name: "boom", guild: { id: "g2" } }, actor);

  assert.equal(res.nuke.isNuke, true);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].actorId, null);
  assert.equal(logs[0].actor, null);
  assert.equal(logs[0].targetId, "cBoom");
  assert.equal(logs[0].target, "#boom (cBoom)");
});

test("alerte nuke: suppression par (guild, action) et non par acteur", async () => {
  const logs = [];
  const runtime = makeRuntime(logs);
  const actorA = { executor: "A (ua)", executorId: "ua", reason: null };
  const actorB = { executor: "B (ub)", executorId: "ub", reason: null };

  for (let i = 0; i < 9; i++) {
    await runtime.handleChannelCreate({ id: `a${i}`, name: `a${i}`, guild: { id: "g3" } }, actorA);
  }
  // 10ᵉ → seuil atteint → 1ʳᵉ alerte (acteur A).
  await runtime.handleChannelCreate({ id: "aX", name: "aX", guild: { id: "g3" } }, actorA);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].actorId, "ua");

  // Même guilde + même action, acteur DIFFÉRENT, dans la fenêtre → supprimée.
  await runtime.handleChannelCreate({ id: "aY", name: "aY", guild: { id: "g3" } }, actorB);
  assert.equal(logs.length, 1); // aucune alerte supplémentaire
});

test("alerte nuke: rétrocompatible — signature (obj) sans acteur → actorId/actor null", async () => {
  const logs = [];
  const runtime = makeRuntime(logs);
  for (let i = 0; i < 9; i++) {
    await runtime.handleChannelCreate({ id: `z${i}`, name: `z${i}`, guild: { id: "g4" } });
  }
  const res = await runtime.handleChannelCreate({ id: "zX", name: "zX", guild: { id: "g4" } });

  assert.equal(res.nuke.isNuke, true);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].actorId, null);
  assert.equal(logs[0].actor, null);
  assert.equal(logs[0].targetId, "zX");
});
