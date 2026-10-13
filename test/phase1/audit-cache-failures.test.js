"use strict";

/**
 * PHASE 1 (correctif 2) — un échec de lecture de l'Audit Log n'est plus une
 * absence d'entrée.
 *
 * L'ancien `catch { return [] }` mettait la liste vide en cache 3 s sans aucun
 * log : une permission « Voir les logs d'audit » manquante produisait exactement
 * le même effet qu'une absence d'entrée — aucun log de rôle, aucune trace, aucun
 * diagnostic possible. Ces tests verrouillent les trois exigences :
 *   • un échec n'est JAMAIS mis en cache ;
 *   • l'échec est distinguable (`available: false` + motif) et journalisé ;
 *   • l'isolation par `guild_id` et par type est conservée.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  readAuditLog,
  fetchAuditLogEntries,
  auditFailureReason,
  _clearCache,
  _getCache,
  _getFailureWarnedAt,
  CACHE_TTL_MS,
  DEFAULT_LIMIT,
} = require("../../src/utils/auditLogCache");
const logger = require("../../src/utils/logger");

const warns = [];

function captureWarns() {
  warns.length = 0;
  logger.warn = (...args) => warns.push(args[1] || { message: args[0] });
}

function failingGuild(guildId, error) {
  const state = { calls: 0 };
  return {
    id: guildId,
    state,
    fetchAuditLogs: async () => {
      state.calls += 1;
      throw error;
    },
  };
}

function workingGuild(guildId, entries) {
  const state = { calls: 0 };
  return {
    id: guildId,
    state,
    fetchAuditLogs: async ({ limit }) => {
      state.calls += 1;
      state.lastLimit = limit;
      return { entries: { filter: () => entries } };
    },
  };
}

test("PHASE1-FIX2: un échec n'est PAS mis en cache comme une absence", async () => {
  _clearCache();
  captureWarns();
  const guild = failingGuild("G1", Object.assign(new Error("Missing Permissions"), { code: 50013 }));

  await readAuditLog(guild, 25);
  await readAuditLog(guild, 25);

  assert.equal(guild.state.calls, 2, "chaque événement doit retenter la lecture, jamais resservir un échec");
  assert.equal(_getCache().size, 0, "aucun succès à mettre en cache");
});

test("PHASE1-FIX2: un échec est distinguable et porte un motif", async () => {
  _clearCache();
  captureWarns();
  const guild = failingGuild("G1", Object.assign(new Error("Missing Permissions"), { code: 50013 }));

  const result = await readAuditLog(guild, 25);

  assert.deepEqual(result.entries, []);
  assert.equal(result.available, false);
  assert.equal(result.reason, "MISSING_PERMISSIONS");
});

test("PHASE1-FIX2: un succès EST mis en cache (une seule requête API)", async () => {
  _clearCache();
  captureWarns();
  const entry = { id: "E1", target: { id: "u1" } };
  const guild = workingGuild("G1", [entry]);

  const first = await readAuditLog(guild, 25);
  const second = await readAuditLog(guild, 25);

  assert.equal(guild.state.calls, 1, "le single-flight et le cache évitent la seconde requête");
  assert.equal(guild.state.lastLimit, DEFAULT_LIMIT);
  assert.equal(first.available, true);
  assert.deepEqual(second.entries, [entry]);
  assert.equal(_getCache().size, 1);
  assert.ok(_getCache().get("G1:25").expiresAt > Date.now(), "le succès est borné par le TTL");
  assert.ok(_getCache().get("G1:25").expiresAt <= Date.now() + CACHE_TTL_MS);
});

test("PHASE1-FIX2: un succès puis une panne ne pollue pas le cache", async () => {
  _clearCache();
  captureWarns();
  const entry = { id: "E1", target: { id: "u1" } };
  let fail = false;
  const guild = {
    id: "G1",
    fetchAuditLogs: async () => {
      if (fail) throw Object.assign(new Error("You are being rate limited."), { code: 429 });
      return { entries: { filter: () => [entry] } };
    },
  };

  assert.equal((await readAuditLog(guild, 25)).available, true);
  _clearCache();                      // TTL écoulé
  fail = true;
  const after = await readAuditLog(guild, 25);

  assert.equal(after.available, false);
  assert.equal(after.reason, "RATE_LIMITED");
  assert.equal(_getCache().size, 0, "la panne n'a rien écrit dans le cache");
});

test("PHASE1-FIX2: l'échec est journalisé une fois par (guild_id, type) et par fenêtre", async () => {
  _clearCache();
  captureWarns();
  const guild = failingGuild("G1", Object.assign(new Error("Missing Permissions"), { code: 50013 }));

  await readAuditLog(guild, 25);
  await readAuditLog(guild, 25);
  await readAuditLog(guild, 25);

  const readFailed = warns.filter((entry) => entry.event === "AUDIT_LOG_READ_FAILED");
  assert.equal(readFailed.length, 1, "anti-bruit : un serveur sans la permission ne doit pas noyer les logs");
  assert.equal(readFailed[0].guildId, "G1");
  assert.equal(readFailed[0].type, 25);
  assert.equal(readFailed[0].reason, "MISSING_PERMISSIONS");
  assert.equal(_getFailureWarnedAt().size, 1);

  _clearCache();                      // nouvelle fenêtre
  await readAuditLog(guild, 25);
  assert.equal(warns.filter((entry) => entry.event === "AUDIT_LOG_READ_FAILED").length, 2);
});

test("PHASE1-FIX2: isolation stricte par guild_id", async () => {
  _clearCache();
  captureWarns();
  const entryA = { id: "EA", target: { id: "u1" } };
  const guildA = workingGuild("GA", [entryA]);
  const guildB = failingGuild("GB", Object.assign(new Error("Missing Permissions"), { code: 50013 }));

  const a = await readAuditLog(guildA, 25);
  const b = await readAuditLog(guildB, 25);

  assert.deepEqual(a.entries, [entryA]);
  assert.equal(a.available, true);
  assert.deepEqual(b.entries, []);
  assert.equal(b.available, false);
  assert.equal(_getCache().has("GA:25"), true);
  assert.equal(_getCache().has("GB:25"), false, "la panne du serveur B ne contamine pas le serveur A");
});

test("PHASE1-FIX2: isolation stricte par type d'audit", async () => {
  _clearCache();
  captureWarns();
  const entry25 = { id: "E25", target: { id: "u1" } };
  const entry20 = { id: "E20", target: { id: "u1" } };
  const guild = {
    id: "G1",
    state: { calls: 0 },
    fetchAuditLogs: async ({ type }) => {
      guild.state.calls += 1;
      return { entries: { filter: () => (type === 25 ? [entry25] : [entry20]) } };
    },
  };

  const roles = await readAuditLog(guild, 25);
  const kicks = await readAuditLog(guild, 20);

  assert.deepEqual(roles.entries, [entry25]);
  assert.deepEqual(kicks.entries, [entry20], "chaque type a sa propre lecture");
  assert.equal(guild.state.calls, 2);
  assert.equal(_getCache().size, 2);
});

test("PHASE1-FIX2: guilde inexploitable → échec explicite, aucune requête", async () => {
  _clearCache();
  captureWarns();

  assert.deepEqual(await readAuditLog(null, 25), { entries: [], available: false, reason: "GUILD_UNAVAILABLE" });
  assert.deepEqual(await readAuditLog({}, 25), { entries: [], available: false, reason: "GUILD_UNAVAILABLE" });
});

test("PHASE1-FIX2: fetchAuditLogEntries reste rétrocompatible (tableau, vide en cas d'échec)", async () => {
  _clearCache();
  captureWarns();
  const entry = { id: "E1", target: { id: "u1" } };

  assert.deepEqual(await fetchAuditLogEntries(workingGuild("G1", [entry]), 25), [entry]);
  assert.deepEqual(
    await fetchAuditLogEntries(failingGuild("G2", Object.assign(new Error("Missing Access"), { code: 50001 })), 25),
    [],
  );
});

test("PHASE1-FIX2: les motifs d'échec sont nommés sans remonter l'erreur brute", () => {
  assert.equal(auditFailureReason(Object.assign(new Error("x"), { code: 50013 })), "MISSING_PERMISSIONS");
  assert.equal(auditFailureReason(new Error("Missing Permissions")), "MISSING_PERMISSIONS");
  assert.equal(auditFailureReason(Object.assign(new Error("x"), { code: 429 })), "RATE_LIMITED");
  assert.equal(auditFailureReason(new Error("You are being rate limited.")), "RATE_LIMITED");
  assert.equal(auditFailureReason(Object.assign(new Error("x"), { code: 50001 })), "MISSING_ACCESS");
  assert.equal(auditFailureReason(new Error("socket hang up")), "READ_FAILED");
  assert.equal(auditFailureReason(null), "READ_FAILED");
});
