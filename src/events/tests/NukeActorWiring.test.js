"use strict";

/**
 * P2-A — câblage des événements channel/role : l'acteur (Audit Log) est résolu
 * UNE SEULE FOIS puis PARTAGÉ entre Logs et Security.
 *
 * Ces tests isolent les quatre événements (`channelCreate`, `channelDelete`,
 * `roleCreate`, `roleDelete`) en stubbant leurs dépendances via `require.cache`
 * AVANT leur chargement (les événements déstructurent leurs imports au sommet du
 * module). On vérifie le contrat produit par l'événement, pas la logique interne
 * de `resolveAuditActor` (couverte par `SecurityNukeActor.test.js`).
 *
 * Invariants vérifiés :
 *  • une seule résolution d'Audit Log par événement (jamais de second resolve
 *    côté Security — l'entrée serait déjà consommée) ;
 *  • Logs et Security reçoivent le MÊME résultat (identité d'objet) ;
 *  • résolution si `logs_enabled` OU `security_anti_nuke` (même Logs coupés) ;
 *  • aucune résolution si ni l'un ni l'autre (fail-closed, pas d'appel API) ;
 *  • acteur introuvable → transmis tel quel (null), rien d'inventé ;
 *  • aucune régression Logs (mêmes champs qu'avant, `who` inclus).
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
  config: null, // renvoyé par getGuildConfig
  resolveResult: null, // renvoyé par resolveAuditActor
  configCalls: [],
  resolveCalls: [],
  logsChannelCalls: [],
  logsRoleCalls: [],
  securityCalls: [],
};

function reset() {
  state.config = null;
  state.resolveResult = null;
  state.configCalls.length = 0;
  state.resolveCalls.length = 0;
  state.logsChannelCalls.length = 0;
  state.logsRoleCalls.length = 0;
  state.securityCalls.length = 0;
}

// ── Stubs des dépendances des événements ────────────────────────────
installStub("src/services/guildConfig.js", {
  getGuildConfig: async (guildId) => {
    state.configCalls.push(guildId);
    return state.config;
  },
});

const logsRuntime = {
  disabled: false,
  handleChannelEvent: async (payload) => {
    state.logsChannelCalls.push(payload);
  },
  handleRoleEvent: async (payload) => {
    state.logsRoleCalls.push(payload);
  },
};
installStub("src/modules/logs/runtime/getLogsRuntime.js", { getLogsRuntime: () => logsRuntime });

installStub("src/utils/auditLogActor.js", {
  resolveAuditActor: async (options) => {
    state.resolveCalls.push(options);
    return state.resolveResult;
  },
});

const securityRuntime = {
  handleChannelCreate: async (obj, actor) => state.securityCalls.push({ handler: "handleChannelCreate", obj, actor }),
  handleChannelDelete: async (obj, actor) => state.securityCalls.push({ handler: "handleChannelDelete", obj, actor }),
  handleRoleCreate: async (obj, actor) => state.securityCalls.push({ handler: "handleRoleCreate", obj, actor }),
  handleRoleDelete: async (obj, actor) => state.securityCalls.push({ handler: "handleRoleDelete", obj, actor }),
};
installStub("src/modules/security/runtime/getSecurityRuntime.js", { getSecurityRuntime: () => securityRuntime });

installStub("src/utils/logger.js", { warn() {}, error() {}, info() {}, debug() {} });

// ── Chargement des événements APRÈS installation des stubs ──────────
const channelCreate = require(path.join(ROOT, "src/events/channelCreate.js"));
const channelDelete = require(path.join(ROOT, "src/events/channelDelete.js"));
const roleCreate = require(path.join(ROOT, "src/events/roleCreate.js"));
const roleDelete = require(path.join(ROOT, "src/events/roleDelete.js"));

// ── Doublures channel/role ──────────────────────────────────────────
const makeChannel = (id, guildId, name = "chan") => ({ id, name, guild: { id: guildId } });
const makeRole = (id, guildId, name = "rol") => ({ id, name, guild: { id: guildId } });

// Un acteur « trouvé » réaliste : `resolveAuditActor` renvoie un libellé
// (string) pour `executor` et l'identifiant pour `executorId`.
const foundActor = (id, tag) => ({ executor: `${tag} (${id})`, executorId: id, reason: null });

test("channelCreate: logs+anti_nuke → résolution unique partagée Logs/Security, targetId correct", async () => {
  reset();
  state.config = { logs_enabled: true, security_anti_nuke: true };
  state.resolveResult = foundActor("u1", "Alice#0001");
  const ch = makeChannel("c1", "g1", "general");

  await channelCreate.execute(ch);

  // Une seule résolution, sur la bonne cible et le bon type d'audit.
  assert.equal(state.resolveCalls.length, 1);
  assert.equal(state.resolveCalls[0].targetId, "c1");
  assert.equal(state.resolveCalls[0].type, AuditLogEvent.ChannelCreate);

  // Logs appelés avec les champs d'origine + `who` = l'acteur résolu.
  assert.equal(state.logsChannelCalls.length, 1);
  assert.equal(state.logsChannelCalls[0].action, "channel_created");
  assert.equal(state.logsChannelCalls[0].channel, ch);
  assert.equal(state.logsChannelCalls[0].config, state.config);
  assert.equal(state.logsChannelCalls[0].who, state.resolveResult.executor);

  // Security reçoit le MÊME objet acteur (identité) et le bon channel.
  assert.equal(state.securityCalls.length, 1);
  assert.equal(state.securityCalls[0].handler, "handleChannelCreate");
  assert.equal(state.securityCalls[0].actor, state.resolveResult);
  assert.equal(state.securityCalls[0].obj, ch);
});

test("channelCreate: anti_nuke seul (logs coupés) → résout quand même, Logs non appelés, Security servi", async () => {
  reset();
  state.config = { logs_enabled: false, security_anti_nuke: true };
  state.resolveResult = foundActor("u2", "Bob#0002");

  await channelCreate.execute(makeChannel("c2", "g1"));

  assert.equal(state.resolveCalls.length, 1); // décision 1 : résout même logs coupés
  assert.equal(state.logsChannelCalls.length, 0); // logs coupés → aucun log
  assert.equal(state.securityCalls.length, 1);
  assert.equal(state.securityCalls[0].actor, state.resolveResult);
});

test("channelCreate: logs seuls (anti_nuke coupé) → résout, Logs servis, acteur transmis à Security", async () => {
  reset();
  state.config = { logs_enabled: true, security_anti_nuke: false };
  state.resolveResult = foundActor("u3", "Cara#0003");

  await channelCreate.execute(makeChannel("c3", "g1"));

  assert.equal(state.resolveCalls.length, 1);
  assert.equal(state.logsChannelCalls.length, 1);
  assert.equal(state.logsChannelCalls[0].who, state.resolveResult.executor);
  // L'événement transmet toujours l'acteur ; la gate anti_nuke vit dans le runtime.
  assert.equal(state.securityCalls.length, 1);
  assert.equal(state.securityCalls[0].actor, state.resolveResult);
});

test("channelCreate: ni logs ni anti_nuke → aucune résolution (fail-closed), acteur null à Security", async () => {
  reset();
  state.config = { logs_enabled: false, security_anti_nuke: false };
  state.resolveResult = foundActor("SHOULD_NOT_BE_USED", "Ghost#0000");

  await channelCreate.execute(makeChannel("c4", "g1"));

  assert.equal(state.resolveCalls.length, 0); // aucun appel API inutile
  assert.equal(state.logsChannelCalls.length, 0);
  assert.equal(state.securityCalls.length, 1);
  assert.equal(state.securityCalls[0].actor, null);
});

test("channelCreate: Audit Log indisponible (executor null) → fail-closed, rien d'inventé", async () => {
  reset();
  state.config = { logs_enabled: true, security_anti_nuke: true };
  state.resolveResult = { executor: null, executorId: null, reason: null };

  await channelCreate.execute(makeChannel("c5", "g1"));

  assert.equal(state.resolveCalls.length, 1);
  assert.equal(state.logsChannelCalls[0].who, null);
  assert.equal(state.securityCalls[0].actor.executorId, null);
  assert.equal(state.securityCalls[0].actor.executor, null);
});

test("channelDelete: logs+anti_nuke → résolution unique partagée, type ChannelDelete, action channel_deleted", async () => {
  reset();
  state.config = { logs_enabled: true, security_anti_nuke: true };
  state.resolveResult = foundActor("u6", "Dan#0006");

  await channelDelete.execute(makeChannel("c6", "g1"));

  assert.equal(state.resolveCalls.length, 1);
  assert.equal(state.resolveCalls[0].type, AuditLogEvent.ChannelDelete);
  assert.equal(state.resolveCalls[0].targetId, "c6");
  assert.equal(state.logsChannelCalls[0].action, "channel_deleted");
  assert.equal(state.logsChannelCalls[0].who, state.resolveResult.executor);
  assert.equal(state.securityCalls[0].handler, "handleChannelDelete");
  assert.equal(state.securityCalls[0].actor, state.resolveResult);
});

test("roleCreate: logs+anti_nuke → résolution unique partagée, type RoleCreate, roleId/target corrects", async () => {
  reset();
  state.config = { logs_enabled: true, security_anti_nuke: true };
  state.resolveResult = foundActor("u7", "Eve#0007");
  const role = makeRole("r7", "g1", "Admin");

  await roleCreate.execute(role);

  assert.equal(state.resolveCalls.length, 1);
  assert.equal(state.resolveCalls[0].type, AuditLogEvent.RoleCreate);
  assert.equal(state.resolveCalls[0].targetId, "r7");
  assert.equal(state.logsRoleCalls.length, 1);
  assert.equal(state.logsRoleCalls[0].action, "role_created");
  assert.equal(state.logsRoleCalls[0].roleId, "r7");
  assert.equal(state.logsRoleCalls[0].target, "@Admin (r7)");
  assert.equal(state.logsRoleCalls[0].who, state.resolveResult.executor);
  assert.equal(state.securityCalls[0].handler, "handleRoleCreate");
  assert.equal(state.securityCalls[0].actor, state.resolveResult);
});

test("roleDelete: logs+anti_nuke → résolution unique partagée, type RoleDelete, action role_deleted", async () => {
  reset();
  state.config = { logs_enabled: true, security_anti_nuke: true };
  state.resolveResult = foundActor("u8", "Fay#0008");

  await roleDelete.execute(makeRole("r8", "g1", "Mod"));

  assert.equal(state.resolveCalls.length, 1);
  assert.equal(state.resolveCalls[0].type, AuditLogEvent.RoleDelete);
  assert.equal(state.resolveCalls[0].targetId, "r8");
  assert.equal(state.logsRoleCalls[0].action, "role_deleted");
  assert.equal(state.logsRoleCalls[0].who, state.resolveResult.executor);
  assert.equal(state.securityCalls[0].handler, "handleRoleDelete");
  assert.equal(state.securityCalls[0].actor, state.resolveResult);
});

test("roleCreate: anti_nuke seul (logs coupés) → résout, Logs non appelés, Security servi", async () => {
  reset();
  state.config = { logs_enabled: false, security_anti_nuke: true };
  state.resolveResult = foundActor("u9", "Gus#0009");

  await roleCreate.execute(makeRole("r9", "g1"));

  assert.equal(state.resolveCalls.length, 1);
  assert.equal(state.logsRoleCalls.length, 0);
  assert.equal(state.securityCalls[0].actor, state.resolveResult);
});

test("roleDelete: ni logs ni anti_nuke → aucune résolution, acteur null à Security", async () => {
  reset();
  state.config = { logs_enabled: false, security_anti_nuke: false };
  state.resolveResult = foundActor("NOPE", "Ghost#0000");

  await roleDelete.execute(makeRole("r10", "g1"));

  assert.equal(state.resolveCalls.length, 0);
  assert.equal(state.logsRoleCalls.length, 0);
  assert.equal(state.securityCalls[0].actor, null);
});
