"use strict";

/**
 * P2-B — câblage des événements `channelUpdate` / `roleUpdate`.
 *
 * Même méthode que `NukeActorWiring.test.js` : les dépendances des événements
 * sont stubbées via `require.cache` AVANT leur chargement (les événements
 * déstructurent leurs imports au sommet du module). On vérifie le contrat de
 * l'événement, pas l'intérieur de `resolveAuditActor*` (couvert par
 * `PermsActorResolution.test.js`).
 *
 * Invariants vérifiés :
 *  • UNE seule résolution d'Audit Log par événement, partagée Logs + Security ;
 *  • roleUpdate résout en type RoleUpdate (31) ; channelUpdate en cas normal
 *    ChannelUpdate (11), et avec des overwrites, les types 13/14/15 par
 *    évidence puis 11 en secours, avec les bonnes cibles candidates ;
 *  • résolution si `logs_enabled` OU `security_anti_nuke` (pattern P2-A) ;
 *  • ni l'un ni l'autre → aucune résolution ni appel API (fail-closed) ;
 *  • acteur introuvable → transmis tel quel (null), rien d'inventé ;
 *  • aucune régression Logs (`who` identique à l'acteur résolu).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { AuditLogEvent } = require("discord.js");

const ROOT = path.resolve(__dirname, "..", "..", "..");

function resolveFromRoot(rel) {
  return require.resolve(path.join(ROOT, rel));
}

function installStub(rel, exports) {
  const key = resolveFromRoot(rel);
  require.cache[key] = { id: key, filename: key, loaded: true, exports, children: [], paths: [] };
}

// ── État mutable piloté par chaque cas ──────────────────────────────
const state = {
  config: null,
  resolveResult: null,
  configCalls: [],
  resolveCalls: [],
  sequenceCalls: [],
  logsChannelCalls: [],
  logsRoleCalls: [],
  securityCalls: [],
};

function reset() {
  state.config = null;
  state.resolveResult = null;
  state.configCalls.length = 0;
  state.resolveCalls.length = 0;
  state.sequenceCalls.length = 0;
  state.logsChannelCalls.length = 0;
  state.logsRoleCalls.length = 0;
  state.securityCalls.length = 0;
}

// ── Stubs ───────────────────────────────────────────────────────────
installStub("src/services/guildConfig.js", {
  getGuildConfig: async (guildId) => {
    state.configCalls.push(guildId);
    return state.config;
  },
});

const logsRuntime = {
  disabled: false,
  handleChannelEvent: async (payload) => { state.logsChannelCalls.push(payload); },
  handleRoleEvent: async (payload) => { state.logsRoleCalls.push(payload); },
};
installStub("src/modules/logs/runtime/getLogsRuntime.js", { getLogsRuntime: () => logsRuntime });

const sentinelOverwriteFilter = () => true;
installStub("src/utils/auditLogActor.js", {
  resolveAuditActor: async (options) => {
    state.resolveCalls.push(options);
    return state.resolveResult;
  },
  resolveAuditActorSequence: async (options) => {
    state.sequenceCalls.push(options);
    return state.resolveResult;
  },
  isOverwriteChange: sentinelOverwriteFilter,
});

const securityRuntime = {
  handleChannelPermsUpdate: async (obj, changes, actor) => state.securityCalls.push({ handler: "handleChannelPermsUpdate", obj, changes, actor }),
  handleRolePermsUpdate: async (obj, changes, actor) => state.securityCalls.push({ handler: "handleRolePermsUpdate", obj, changes, actor }),
};
installStub("src/modules/security/runtime/getSecurityRuntime.js", { getSecurityRuntime: () => securityRuntime });

installStub("src/utils/logger.js", { warn() {}, error() {}, info() {}, debug() {} });

// ── Chargement des événements APRÈS installation des stubs ──────────
const channelUpdate = require(path.join(ROOT, "src/events/channelUpdate.js"));
const roleUpdate = require(path.join(ROOT, "src/events/roleUpdate.js"));

// ── Doublures ───────────────────────────────────────────────────────
function bitfield(names) {
  return { toArray: () => [...names] };
}

function makeRole(guildId, overrides = {}) {
  return {
    id: "R1",
    name: "Modérateur",
    hexColor: "#ff0000",
    color: 0xff0000,
    hoist: false,
    mentionable: false,
    permissions: bitfield(["ViewChannel"]),
    guild: { id: guildId },
    ...overrides,
  };
}

function makeChannel(guildId, overrides = {}) {
  return {
    id: "C1",
    name: "général",
    topic: "Discussion",
    position: 1,
    rateLimitPerUser: 0,
    nsfw: false,
    parentId: null,
    parent: null,
    permissionOverwrites: { cache: new Map() },
    guild: { id: guildId },
    ...overrides,
  };
}

const foundActor = (id, tag) => ({ executor: `${tag} (${id})`, executorId: id, reason: null });

// ─────────────────────────────────────────────────────────────────────
// roleUpdate
// ─────────────────────────────────────────────────────────────────────

test("P2B roleUpdate: logs+anti_nuke → résolution unique type 31 partagée Logs/Security", async () => {
  reset();
  state.config = { logs_enabled: true, security_anti_nuke: true };
  state.resolveResult = foundActor("u1", "Alice#0001");
  const role = makeRole("g1");
  const updated = makeRole("g1", { permissions: bitfield(["ViewChannel", "Administrator"]) });

  await roleUpdate.execute(role, updated);

  // Une seule résolution, bon type (RoleUpdate = 31) et bonne cible.
  assert.equal(state.resolveCalls.length, 1);
  assert.equal(state.resolveCalls[0].type, AuditLogEvent.RoleUpdate);
  assert.equal(state.resolveCalls[0].type, 31);
  assert.equal(state.resolveCalls[0].targetId, "R1");

  // Logs servis avec who = acteur résolu.
  assert.equal(state.logsRoleCalls.length, 1);
  assert.equal(state.logsRoleCalls[0].action, "role_updated");
  assert.equal(state.logsRoleCalls[0].who, state.resolveResult.executor);

  // Security reçoit le MÊME objet acteur (identité) + les changements.
  assert.equal(state.securityCalls.length, 1);
  assert.equal(state.securityCalls[0].handler, "handleRolePermsUpdate");
  assert.equal(state.securityCalls[0].actor, state.resolveResult);
  assert.equal(state.securityCalls[0].obj, updated, "Security reçoit le rôle NOUVEL état");
  assert.ok(state.securityCalls[0].changes.some((c) => c.key === "permissions"));
});

test("P2B roleUpdate: anti_nuke seul (logs coupés) → résout quand même, Logs non appelés, Security servi", async () => {
  reset();
  state.config = { logs_enabled: false, security_anti_nuke: true };
  state.resolveResult = foundActor("u2", "Bob#0002");

  await roleUpdate.execute(makeRole("g1"), makeRole("g1", { permissions: bitfield(["ViewChannel", "ManageGuild"]) }));

  assert.equal(state.resolveCalls.length, 1);
  assert.equal(state.logsRoleCalls.length, 0);
  assert.equal(state.securityCalls.length, 1);
  assert.equal(state.securityCalls[0].actor, state.resolveResult);
});

test("P2B roleUpdate: ni logs ni anti_nuke → aucune résolution, aucun appel (fail-closed)", async () => {
  reset();
  state.config = { logs_enabled: false, security_anti_nuke: false };
  state.resolveResult = foundActor("SHOULD_NOT", "Ghost#0000");

  await roleUpdate.execute(makeRole("g1"), makeRole("g1", { permissions: bitfield(["Administrator"]) }));

  assert.equal(state.resolveCalls.length, 0, "aucune requête API inutile");
  assert.equal(state.logsRoleCalls.length, 0);
  assert.equal(state.securityCalls.length, 0, "détecteur désactivé des deux côtés → aucun traitement");
});

test("P2B roleUpdate: acteur introuvable → null transmis tel quel (fail-closed)", async () => {
  reset();
  state.config = { logs_enabled: true, security_anti_nuke: true };
  state.resolveResult = { executor: null, executorId: null, reason: null };

  await roleUpdate.execute(makeRole("g1"), makeRole("g1", { permissions: bitfield(["ViewChannel", "BanMembers"]) }));

  assert.equal(state.logsRoleCalls[0].who, null, "rien d'inventé pour les Logs");
  assert.equal(state.securityCalls[0].actor.executor, null);
  assert.equal(state.securityCalls[0].actor.executorId, null);
});

test("P2B roleUpdate: changement sans permissions (couleur) → Logs servis, Security reçoit les changements sans signal", async () => {
  reset();
  state.config = { logs_enabled: true, security_anti_nuke: true };
  state.resolveResult = foundActor("u3", "Cara#0003");

  await roleUpdate.execute(makeRole("g1"), makeRole("g1", { hexColor: "#00ff00", color: 0x00ff00 }));

  assert.equal(state.logsRoleCalls.length, 1, "le log de couleur reste intact");
  assert.equal(state.securityCalls.length, 1);
  assert.ok(!state.securityCalls[0].changes.some((c) => c.key === "permissions"), "aucune clé permissions → pas de compteur");
});

// ─────────────────────────────────────────────────────────────────────
// channelUpdate — cas normal (sans overwrites)
// ─────────────────────────────────────────────────────────────────────

test("P2B channelUpdate: changement simple → types [11], cible = salon, résolution unique partagée", async () => {
  reset();
  state.config = { logs_enabled: true, security_anti_nuke: true };
  state.resolveResult = foundActor("u4", "Dan#0004");
  const channel = makeChannel("g1");
  const updated = makeChannel("g1", { name: "autre" });

  await channelUpdate.execute(channel, updated);

  assert.equal(state.sequenceCalls.length, 1);
  assert.deepEqual(state.sequenceCalls[0].types.map((t) => t.type), [AuditLogEvent.ChannelUpdate]);
  assert.deepEqual(state.sequenceCalls[0].types.map((t) => t.type), [11]);
  assert.deepEqual(state.sequenceCalls[0].targetIds, ["C1"]);

  assert.equal(state.logsChannelCalls.length, 1);
  assert.equal(state.logsChannelCalls[0].action, "channel_updated");
  assert.equal(state.logsChannelCalls[0].who, state.resolveResult.executor);

  assert.equal(state.securityCalls.length, 1);
  assert.equal(state.securityCalls[0].handler, "handleChannelPermsUpdate");
  assert.equal(state.securityCalls[0].actor, state.resolveResult, "même objet acteur (identité)");
  assert.equal(state.securityCalls[0].obj, updated, "Security reçoit le salon NOUVEL état");
  assert.ok(!state.securityCalls[0].changes.some((c) => c.key === "permissions"));
});

// ─────────────────────────────────────────────────────────────────────
// channelUpdate — modifications d'overwrites (13/14/15)
// ─────────────────────────────────────────────────────────────────────

test("P2B channelUpdate: overwrite AJOUTÉ → types 13 puis 11 en secours, cibles salon + overwrite touché", async () => {
  reset();
  state.config = { logs_enabled: true, security_anti_nuke: true };
  state.resolveResult = foundActor("u5", "Eve#0005");
  const before = makeChannel("g1");
  const after = makeChannel("g1", {
    permissionOverwrites: { cache: new Map([["R9", { allow: bitfield(["ViewChannel"]), deny: bitfield([]) }]]) },
  });

  await channelUpdate.execute(before, after);

  assert.equal(state.sequenceCalls.length, 1, "UNE seule séquence de résolution");
  const types = state.sequenceCalls[0].types;
  assert.equal(types[0].type, AuditLogEvent.ChannelOverwriteCreate, "évidence : surcharge ajoutée → 13");
  assert.equal(types[0].type, 13);
  assert.equal(typeof types[0].changeFilter, "function", "garde de nature sur les types overwrite");
  assert.equal(types[types.length - 1].type, AuditLogEvent.ChannelUpdate, "cas normal 11 en secours");
  assert.deepEqual(state.sequenceCalls[0].targetIds, ["C1", "R9"], "salon d'abord, puis overwrite touché");

  assert.equal(state.logsChannelCalls[0].who, state.resolveResult.executor);
  assert.equal(state.securityCalls[0].actor, state.resolveResult);
});

test("P2B channelUpdate: overwrite MODIFIÉ → type 14 en tête ; RETIRÉ → type 15", async () => {
  reset();
  state.config = { logs_enabled: true, security_anti_nuke: true };
  state.resolveResult = foundActor("u6", "Fay#0006");

  // modifié : même id, allow différent
  await channelUpdate.execute(
    makeChannel("g1", { permissionOverwrites: { cache: new Map([["R1", { allow: bitfield([]), deny: bitfield(["SendMessages"]) }]]) } }),
    makeChannel("g1", { permissionOverwrites: { cache: new Map([["R1", { allow: bitfield(["SendMessages"]), deny: bitfield([]) }]]) } }),
  );
  assert.equal(state.sequenceCalls[0].types[0].type, AuditLogEvent.ChannelOverwriteUpdate);
  assert.equal(state.sequenceCalls[0].types[0].type, 14);
  assert.deepEqual(state.sequenceCalls[0].targetIds, ["C1", "R1"]);

  reset();
  state.config = { logs_enabled: true, security_anti_nuke: true };
  state.resolveResult = foundActor("u7", "Gus#0007");

  // retiré : présent avant, absent après
  await channelUpdate.execute(
    makeChannel("g1", { permissionOverwrites: { cache: new Map([["R2", { allow: bitfield([]), deny: bitfield(["ViewChannel"]) }]]) } }),
    makeChannel("g1"),
  );
  assert.equal(state.sequenceCalls[0].types[0].type, AuditLogEvent.ChannelOverwriteDelete);
  assert.equal(state.sequenceCalls[0].types[0].type, 15);
  assert.deepEqual(state.sequenceCalls[0].targetIds, ["C1", "R2"]);
});

test("P2B channelUpdate: anti_nuke seul (logs coupés) + overwrites → résout quand même, Security servi", async () => {
  reset();
  state.config = { logs_enabled: false, security_anti_nuke: true };
  state.resolveResult = foundActor("u8", "Hugo#0008");
  const before = makeChannel("g1");
  const after = makeChannel("g1", {
    permissionOverwrites: { cache: new Map([["R1", { allow: bitfield([]), deny: bitfield(["SendMessages"]) }]]) },
  });

  await channelUpdate.execute(before, after);

  assert.equal(state.sequenceCalls.length, 1);
  assert.equal(state.logsChannelCalls.length, 0);
  assert.equal(state.securityCalls.length, 1);
  assert.equal(state.securityCalls[0].actor, state.resolveResult);
  assert.ok(state.securityCalls[0].changes.some((c) => c.key === "permissions"));
});

test("P2B channelUpdate: ni logs ni anti_nuke → aucune résolution, aucun appel", async () => {
  reset();
  state.config = { logs_enabled: false, security_anti_nuke: false };
  state.resolveResult = foundActor("NOPE", "Ghost#0001");

  await channelUpdate.execute(makeChannel("g1"), makeChannel("g1", { name: "x" }));

  assert.equal(state.sequenceCalls.length, 0);
  assert.equal(state.logsChannelCalls.length, 0);
  assert.equal(state.securityCalls.length, 0);
});

test("P2B channelUpdate: Audit Log sans correspondance → who null, Security reçoit null (fail-closed)", async () => {
  reset();
  state.config = { logs_enabled: true, security_anti_nuke: true };
  state.resolveResult = { executor: null, executorId: null, reason: null, matchedType: null, matchedTargetId: null };

  await channelUpdate.execute(makeChannel("g1"), makeChannel("g1", { name: "x" }));

  assert.equal(state.logsChannelCalls[0].who, null);
  assert.equal(state.securityCalls[0].actor.executor, null);
});
