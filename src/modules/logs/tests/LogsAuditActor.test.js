"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { resolveAuditActor } = require("../../../utils/auditLogActor");
const { _clearCache } = require("../../../utils/auditLogCache");

function makeGuild(entry, id = "g") {
  return {
    id,
    fetchAuditLogs: async () => ({ entries: { first: () => entry || null } }),
  };
}

test("resolveAuditActor renvoie exécutant, id et raison quand la cible correspond", async () => {
  _clearCache();
  const guild = makeGuild(
    {
      target: { id: "U1" },
      executor: { id: "M1", tag: "Modo" },
      reason: "spam",
    },
    "g-match",
  );
  const result = await resolveAuditActor({ guild, type: 20, targetId: "U1" });
  assert.equal(result.executor, "Modo (M1)");
  assert.equal(result.executorId, "M1");
  assert.equal(result.reason, "spam");
});

test("resolveAuditActor filtre une entrée appartenant à une AUTRE cible", async () => {
  _clearCache();
  const guild = makeGuild(
    {
      target: { id: "AUTRE" },
      executor: { id: "M1", tag: "Modo" },
      reason: "x",
    },
    "g-other",
  );
  const result = await resolveAuditActor({ guild, type: 20, targetId: "U1" });
  assert.equal(result.executor, null);
  assert.equal(result.executorId, null);
  assert.equal(result.reason, null);
});

test("resolveAuditActor sans entrée (null) ne fabrique aucun acteur", async () => {
  _clearCache();
  const guild = makeGuild(null, "g-empty");
  const result = await resolveAuditActor({ guild, type: 20, targetId: "U1" });
  assert.deepEqual(result, { executor: null, executorId: null, reason: null });
});

test("resolveAuditActor sans cible fournie n'appelle pas l'audit log", async () => {
  _clearCache();
  let calls = 0;
  const guild = { id: "g-nocall", fetchAuditLogs: async () => { calls += 1; return { entries: { first: () => null } }; } };
  const result = await resolveAuditActor({ guild, type: 20 });
  assert.deepEqual(result, { executor: null, executorId: null, reason: null });
  assert.equal(calls, 0);
});

test("resolveAuditActor pour les invitations vérifie le code de la cible", async () => {
  _clearCache();
  const guild = makeGuild(
    { target: { code: "abc123" }, executor: { id: "M1", tag: "Modo" }, reason: null },
    "g-invite",
  );
  const ok = await resolveAuditActor({ guild, type: 42, targetCode: "abc123" });
  assert.equal(ok.executor, "Modo (M1)");
  const mismatch = await resolveAuditActor({ guild, type: 42, targetCode: "other" });
  assert.equal(mismatch.executor, null);
});

test("resolveAuditActor sans exécuteur renvoie des champs null", async () => {
  _clearCache();
  const guild = makeGuild({ target: { id: "U1" }, executor: null, reason: "r" }, "g-noexec");
  const result = await resolveAuditActor({ guild, type: 20, targetId: "U1" });
  assert.equal(result.executor, null);
  assert.equal(result.executorId, null);
  assert.equal(result.reason, "r");
});

// ───────────────────────────────────────────────────────────────
// Delta de rôles autoritaire ($add / $remove) — jamais le cache
// ───────────────────────────────────────────────────────────────

const { resolveRoleDelta, roleDelta } = require("../../../utils/auditLogActor");

test("roleDelta extrait les rôles ajoutés ($add) et retirés ($remove)", () => {
  const { added, removed } = roleDelta([
    { key: "$add", new: [{ id: "R1", name: "Modo" }] },
    { key: "$remove", new: [{ id: "R2", name: "Old" }] },
  ]);
  assert.deepEqual(added, [{ id: "R1", name: "Modo" }]);
  assert.deepEqual(removed, [{ id: "R2", name: "Old" }]);
});

test("roleDelta ignore les clés inconnues et gère changes null/non-tableau", () => {
  assert.deepEqual(roleDelta(null), { added: [], removed: [] });
  assert.deepEqual(roleDelta(undefined), { added: [], removed: [] });
  assert.deepEqual(roleDelta([{ key: "nick", new: "x" }]), { added: [], removed: [] });
});

test("resolveRoleDelta renvoie le delta exact + exécutant quand la cible correspond", async () => {
  _clearCache();
  const guild = makeGuild(
    {
      target: { id: "U1" },
      executor: { id: "M1", tag: "Modo" },
      reason: "r",
      changes: [
        { key: "$add", new: [{ id: "R1", name: "Modo" }] },
        { key: "$remove", new: [{ id: "R2", name: "Old" }] },
      ],
    },
    "g-role-ok",
  );
  const result = await resolveRoleDelta({ guild, type: 25, memberId: "U1" });
  assert.equal(result.executor, "Modo (M1)");
  assert.equal(result.executorId, "M1");
  assert.equal(result.reason, "r");
  assert.deepEqual(result.addedRoles, [{ id: "R1", name: "Modo" }]);
  assert.deepEqual(result.removedRoles, [{ id: "R2", name: "Old" }]);
});

test("resolveRoleDelta sans entrée → listes vides (jamais de faux delta)", async () => {
  _clearCache();
  const guild = makeGuild(null, "g-role-empty");
  const result = await resolveRoleDelta({ guild, type: 25, memberId: "U1" });
  assert.deepEqual(result.addedRoles, []);
  assert.deepEqual(result.removedRoles, []);
  assert.equal(result.executor, null);
  assert.equal(result.executorId, null);
  assert.equal(result.reason, null);
});

test("resolveRoleDelta filtre une entrée appartenant à une AUTRE cible", async () => {
  _clearCache();
  const guild = makeGuild(
    { target: { id: "AUTRE" }, changes: [{ key: "$add", new: [{ id: "R1", name: "X" }] }] },
    "g-role-other",
  );
  const result = await resolveRoleDelta({ guild, type: 25, memberId: "U1" });
  assert.deepEqual(result.addedRoles, []);
  assert.deepEqual(result.removedRoles, []);
});
