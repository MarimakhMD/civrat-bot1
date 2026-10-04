"use strict";

/**
 * PHASE 1 (correctif 4) — corrélation des changements de rôles et faux log de
 * pseudo sur un simple ajout/retrait de rôle.
 *
 * DEUX CAUSES RACINES, toutes deux démontrées ici contre le VRAI discord.js :
 *
 *  A) `entry.target` vaut `null` quand l'utilisateur visé n'est pas déjà dans
 *     `client.users.cache` et que `Partials.User` est absent — ce qui est la
 *     configuration de CIVRAT (`partials: [Message, Channel, GuildMember]`).
 *     `matchesTarget` comparait `entry.target.id` : TOUTES les entrées étaient
 *     rejetées → `LOG_ROLE_DELTA_UNRESOLVED / NO_MATCHING_ENTRY` alors que
 *     l'entrée était bien présente. `entry.targetId` vient du payload brut et
 *     est toujours renseigné.
 *
 *  B) `Partials.GuildMember` est actif : un membre peut entrer en cache depuis
 *     un payload partiel (réaction, thread, voix) qui ne porte ni `nick` ni
 *     `communication_disabled_until`. Ces champs valent alors `null` — défaut de
 *     constructeur, pas valeur réelle. L'arrivée du premier payload complet
 *     (ici déclenchée par un simple ajout de rôle) fait apparaître un faux
 *     changement de pseudo. `GuildMember#partial` en est le marqueur exact.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { GuildAuditLogsEntry, Partials, AuditLogEvent } = require("discord.js");
const { Collection } = require("@discordjs/collection");

const guildConfigService = require("../../src/services/guildConfig");
const getLogsRuntimeModule = require("../../src/modules/logs/runtime/getLogsRuntime");
const auditLogCache = require("../../src/utils/auditLogCache");
const auditLogActor = require("../../src/utils/auditLogActor");
const selfActionRegistry = require("../../src/utils/selfActionRegistry");
const logger = require("../../src/utils/logger");

const {
  matchesTarget,
  entryTargetId,
  resolveRoleDeltasDetailed,
  AuditLogEventType,
  _resetConsumed,
} = auditLogActor;

const handler = require("../../src/events/guildMemberUpdate");

const TARGET_ID = "111111111111111111";
const MODERATOR_ID = "999999999999999999";

// ─────────────────────────────────────────────────────────────
// A) La cible d'une entrée d'audit — prouvé avec le vrai discord.js
// ─────────────────────────────────────────────────────────────

/** Entrée brute d'un ajout de rôle, telle que renvoyée par l'API Discord. */
const RAW_ROLE_ENTRY = Object.freeze({
  id: "E1",
  user_id: MODERATOR_ID,
  action_type: AuditLogEvent.MemberRoleUpdate,
  target_id: TARGET_ID,
  changes: [{ key: "$add", new_value: [{ id: "r1", name: "Membre" }] }],
});

function auditGuild({ userCached }) {
  const users = new Collection();
  if (userCached) users.set(TARGET_ID, { id: TARGET_ID, username: "alice" });
  const guild = {
    id: "G1",
    client: {
      users: {
        cache: users,
        _add: (data) => {
          const user = { id: data.id, username: data.username };
          users.set(user.id, user);
          return user;
        },
      },
      // Configuration réelle de CIVRAT (index.js) : Partials.User ABSENT.
      options: { partials: [Partials.Message, Partials.Channel, Partials.GuildMember] },
      guilds: { cache: new Collection() },
      channels: { cache: new Collection() },
    },
    roles: { cache: new Collection() },
    members: { cache: new Collection(), resolve: () => null },
    emojis: { cache: new Collection() },
    webhooks: { cache: new Collection() },
    invites: { cache: new Collection() },
    integrations: { cache: new Collection() },
    stageInstances: { cache: new Collection() },
    stickers: { cache: new Collection() },
    scheduledEvents: { cache: new Collection() },
    autoModerationRules: { cache: new Collection() },
  };
  return guild;
}

function realEntry({ userCached }) {
  return new GuildAuditLogsEntry(
    auditGuild({ userCached }),
    { ...RAW_ROLE_ENTRY },
    { entries: new Collection(), users: new Collection() },
  );
}

test("PHASE1-FIX4: discord.js résout la cible d'un MemberRoleUpdate en Targets.User", () => {
  assert.equal(GuildAuditLogsEntry.targetType(AuditLogEvent.MemberRoleUpdate), "User");
  assert.equal(AuditLogEventType.MEMBER_ROLE_UPDATE, AuditLogEvent.MemberRoleUpdate);
});

test("PHASE1-FIX4: entry.target vaut null quand l'utilisateur n'est pas en cache (config CIVRAT)", () => {
  const entry = realEntry({ userCached: false });

  assert.equal(entry.target, null, "discord.js ne fabrique pas la cible sans Partials.User");
  assert.equal(entry.targetId, TARGET_ID, "targetId vient du payload brut : toujours présent");
});

test("PHASE1-FIX4: matchesTarget retrouve l'entrée via entry.targetId", () => {
  const uncached = realEntry({ userCached: false });
  const cached = realEntry({ userCached: true });

  assert.equal(matchesTarget(uncached, TARGET_ID, null), true, "l'entrée doit être corrélée même sans cible résolue");
  assert.equal(matchesTarget(cached, TARGET_ID, null), true);
  assert.equal(matchesTarget(uncached, "222222222222222222", null), false, "un autre membre ne correspond pas");
});

test("PHASE1-FIX4: les fixtures historiques { target: { id } } restent compatibles", () => {
  assert.equal(entryTargetId({ target: { id: "U1" } }), "U1");
  assert.equal(entryTargetId({ targetId: "U1" }), "U1");
  assert.equal(entryTargetId({ targetId: "U1", target: { id: "AUTRE" } }), "U1", "targetId a priorité");
  assert.equal(entryTargetId({}), null);
  assert.equal(entryTargetId(null), null);
  assert.equal(matchesTarget({ target: { code: "abc" } }, null, "abc"), true, "les invitations passent toujours par target.code");
});

test("PHASE1-FIX4: resolveRoleDeltasDetailed corrèle une entrée dont target est null", async () => {
  auditLogCache._clearCache();
  _resetConsumed();

  const uncached = realEntry({ userCached: false });
  const guild = {
    id: "G1",
    fetchAuditLogs: async () => ({ entries: { filter: () => [uncached] } }),
  };

  const result = await resolveRoleDeltasDetailed({
    guild,
    type: AuditLogEventType.MEMBER_ROLE_UPDATE,
    memberId: TARGET_ID,
    occurredAt: Date.now(),
  });

  assert.equal(result.available, true);
  assert.equal(result.deltas.length, 1, "l'entrée doit être attribuée");
  assert.equal(result.deltas[0].addedRoles.length, 1);
  assert.equal(result.deltas[0].addedRoles[0].id, "r1");
  assert.equal(result.deltas[0].entryId, "E1");
});

// ─────────────────────────────────────────────────────────────
// B) Chaîne complète guildMemberUpdate → Logs
// ─────────────────────────────────────────────────────────────

const sent = [];
const warns = [];

function fakeLogsRuntime() {
  return {
    handleRoleEvent: async (entry) => {
      sent.push({ action: entry.action, roleId: entry.roleId, memberId: entry.memberId, member: entry.member, who: entry.who, target: entry.target });
    },
    handleMemberNicknameChanged: async (payload) => {
      sent.push({ action: "member_nickname_changed", memberId: payload.memberId, before: payload.before, after: payload.after });
    },
    handleModerationEvent: async (entry) => {
      sent.push({ action: entry.action, memberId: entry.targetId });
    },
  };
}

/**
 * Membre fidèle à discord.js.
 * `partial: true` reproduit un membre entré en cache depuis un payload partiel :
 * `nickname` et `communicationDisabledUntilTimestamp` valent alors `null`
 * (défauts de constructeur) et `_roles` est vide.
 */
function makeMember({ id, nickname = null, roleIds = [], timeout = null, partial = false, guild }) {
  const member = {
    id,
    guild,
    partial,
    joinedTimestamp: partial ? null : Date.now(),
    nickname,
    communicationDisabledUntilTimestamp: timeout,
    _roles: roleIds.slice(),
    user: { tag: `user${id}`, id, displayAvatarURL: () => null },
  };
  Object.defineProperty(member, "roles", {
    get() {
      const cache = new Map();
      cache.set(guild.id, { id: guild.id, name: "@everyone" });
      for (const roleId of member._roles) {
        const role = guild.roles.cache.get(roleId);
        if (role) cache.set(roleId, role);
      }
      return { cache };
    },
  });
  return member;
}

function makeGuild({ audit = async () => ({ entries: { filter: () => [] } }) } = {}) {
  const guild = {
    id: "G1",
    roles: { cache: new Map([["r1", { id: "r1", name: "Membre" }], ["r2", { id: "r2", name: "VIP" }]]) },
  };
  guild.fetchAuditLogs = audit;
  return guild;
}

function roleAudit(entries) {
  return async () => ({ entries: { filter: () => entries } });
}

function auditRoleEntry({ id, memberId, added = [], removed = [], executor = { id: MODERATOR_ID, tag: "Moderator" } }) {
  const changes = [];
  if (added.length > 0) changes.push({ key: "$add", new: added });
  if (removed.length > 0) changes.push({ key: "$remove", new: removed });
  return { id, targetId: memberId, target: null, executor, createdAt: new Date(Date.now() - 400), changes };
}

function reset({ config } = {}) {
  sent.length = 0;
  warns.length = 0;
  auditLogCache._clearCache();
  _resetConsumed();
  selfActionRegistry._clearSelfActions();
  logger.warn = (...args) => warns.push(args[1] || { message: args[0] });
  getLogsRuntimeModule.getLogsRuntime = fakeLogsRuntime;
  guildConfigService.getGuildConfig = async () => config || {
    logs_enabled: true,
    language: "fr",
    log_role_update_channel_id: "c",
    log_moderation_channel_id: "c",
  };
}

const byAction = (action) => sent.filter((entry) => entry.action === action);

test("PHASE1-FIX4: ajout de rôle seul → exactement 1 log rôle ajouté, 0 pseudo", async () => {
  reset();
  const guild = makeGuild({
    audit: roleAudit([auditRoleEntry({ id: "E1", memberId: "u1", added: [{ id: "r1", name: "Membre" }] })]),
  });

  await handler.execute(
    makeMember({ id: "u1", nickname: "Alice", roleIds: [], guild }),
    makeMember({ id: "u1", nickname: "Alice", roleIds: ["r1"], guild }),
  );

  assert.equal(byAction("member_role_added").length, 1);
  assert.equal(byAction("member_role_removed").length, 0);
  assert.equal(byAction("member_nickname_changed").length, 0, "aucun pseudo modifié sur un simple ajout de rôle");
  assert.equal(byAction("member_role_added")[0].roleId, "r1");
  assert.equal(byAction("member_role_added")[0].memberId, "u1");
  assert.equal(byAction("member_role_added")[0].who, `Moderator (${MODERATOR_ID})`);
});

test("PHASE1-FIX4: retrait de rôle seul → exactement 1 log rôle retiré, 0 pseudo", async () => {
  reset();
  const guild = makeGuild({
    audit: roleAudit([auditRoleEntry({ id: "E1", memberId: "u1", removed: [{ id: "r2", name: "VIP" }] })]),
  });

  await handler.execute(
    makeMember({ id: "u1", nickname: "Alice", roleIds: ["r1", "r2"], guild }),
    makeMember({ id: "u1", nickname: "Alice", roleIds: ["r1"], guild }),
  );

  assert.equal(byAction("member_role_removed").length, 1);
  assert.equal(byAction("member_role_added").length, 0);
  assert.equal(byAction("member_nickname_changed").length, 0);
  assert.equal(byAction("member_role_removed")[0].roleId, "r2");
  assert.equal(byAction("member_role_removed")[0].target, "@VIP (r2)");
});

test("PHASE1-FIX4: changement de pseudo seul → exactement 1 log pseudo, 0 rôle", async () => {
  reset();
  const guild = makeGuild();

  await handler.execute(
    makeMember({ id: "u1", nickname: "Alice", roleIds: ["r1"], guild }),
    makeMember({ id: "u1", nickname: "Bob", roleIds: ["r1"], guild }),
  );

  assert.equal(byAction("member_nickname_changed").length, 1);
  assert.equal(byAction("member_role_added").length, 0);
  assert.equal(byAction("member_role_removed").length, 0);
  assert.equal(byAction("member_nickname_changed")[0].before, "Alice");
  assert.equal(byAction("member_nickname_changed")[0].after, "Bob");
});

test("PHASE1-FIX4: membre PARTIEL + ajout de rôle → 1 log rôle, 0 pseudo (bug signalé)", async () => {
  reset();
  const guild = makeGuild({
    audit: roleAudit([auditRoleEntry({ id: "E1", memberId: "u1", added: [{ id: "r1", name: "Membre" }] })]),
  });

  // Le membre était en cache de façon partielle : pseudo « avant » = null
  // (défaut de constructeur), alors que son vrai pseudo est déjà « Alice ».
  await handler.execute(
    makeMember({ id: "u1", nickname: null, roleIds: [], partial: true, guild }),
    makeMember({ id: "u1", nickname: "Alice", roleIds: ["r1"], guild }),
  );

  assert.equal(byAction("member_nickname_changed").length, 0,
    "l'état « avant » d'un membre partiel n'est pas fiable : aucun pseudo ne doit être inventé");
  assert.equal(byAction("member_role_added").length, 1, "le log de rôle passe par l'Audit Log et reste émis");
  assert.equal(byAction("member_role_added")[0].roleId, "r1");
});

test("PHASE1-FIX4: membre PARTIEL + timeout apparent → aucun log de timeout inventé", async () => {
  reset();
  const guild = makeGuild();

  await handler.execute(
    makeMember({ id: "u1", timeout: null, roleIds: ["r1"], partial: true, guild }),
    makeMember({ id: "u1", timeout: Date.now() + 600_000, roleIds: ["r1"], guild }),
  );

  assert.equal(byAction("member_timed_out").length, 0, "le timeout « avant » d'un membre partiel est un défaut de constructeur");
  assert.equal(byAction("member_nickname_changed").length, 0);
});

test("PHASE1-FIX4: membre PARTIEL sans entrée d'audit → aucun log, aucun faux diagnostic", async () => {
  reset();
  const guild = makeGuild({ audit: roleAudit([]) });

  await handler.execute(
    makeMember({ id: "u1", nickname: null, roleIds: [], partial: true, guild }),
    makeMember({ id: "u1", nickname: "Alice", roleIds: ["r1", "r2"], guild }),
  );

  assert.equal(sent.length, 0, "premier payload complet d'un membre partiel : aucun rôle n'a réellement été attribué");
  assert.equal(warns.filter((entry) => entry.event === "LOG_ROLE_DELTA_UNRESOLVED").length, 0,
    "ce cas n'est pas une anomalie : il ne doit pas noyer les logs");
});

test("PHASE1-FIX4: membre fiable sans entrée d'audit → le diagnostic reste émis", async () => {
  reset();
  const guild = makeGuild({ audit: roleAudit([]) });

  await handler.execute(
    makeMember({ id: "u1", nickname: "Alice", roleIds: [], guild }),
    makeMember({ id: "u1", nickname: "Alice", roleIds: ["r1"], guild }),
  );

  assert.equal(sent.length, 0, "rien n'est inventé");
  const unresolved = warns.filter((entry) => entry.event === "LOG_ROLE_DELTA_UNRESOLVED");
  assert.equal(unresolved.length, 1, "un vrai changement de rôles non corrélé doit rester visible");
  assert.equal(unresolved[0].auditAvailable, true);
  assert.equal(unresolved[0].reason, "NO_MATCHING_ENTRY");
});

test("PHASE1-FIX4: deux événements rapprochés ne mélangent pas leurs états", async () => {
  reset();
  const guild = makeGuild({
    audit: roleAudit([
      auditRoleEntry({ id: "E2", memberId: "u2", added: [{ id: "r2", name: "VIP" }] }),
      auditRoleEntry({ id: "E1", memberId: "u1", added: [{ id: "r1", name: "Membre" }] }),
    ]),
  });

  await Promise.all([
    // u1 : ajout de rôle seul
    handler.execute(
      makeMember({ id: "u1", nickname: "Alice", roleIds: [], guild }),
      makeMember({ id: "u1", nickname: "Alice", roleIds: ["r1"], guild }),
    ),
    // u2 : changement de pseudo seul
    handler.execute(
      makeMember({ id: "u2", nickname: "Bob", roleIds: ["r1"], guild }),
      makeMember({ id: "u2", nickname: "Bobby", roleIds: ["r1"], guild }),
    ),
  ]);

  assert.equal(byAction("member_role_added").length, 1);
  assert.equal(byAction("member_role_added")[0].memberId, "u1");
  assert.equal(byAction("member_role_added")[0].roleId, "r1", "u1 reçoit SON rôle, pas celui d'un autre");

  assert.equal(byAction("member_nickname_changed").length, 1);
  assert.equal(byAction("member_nickname_changed")[0].memberId, "u2");
  assert.equal(byAction("member_nickname_changed")[0].before, "Bob");
  assert.equal(byAction("member_nickname_changed")[0].after, "Bobby");
});

test("PHASE1-FIX4: deux ajouts de rôles rapprochés du même membre → 2 logs, aucun doublon", async () => {
  reset();
  const guild = makeGuild({
    audit: roleAudit([
      auditRoleEntry({ id: "E2", memberId: "u1", added: [{ id: "r2", name: "VIP" }] }),
      auditRoleEntry({ id: "E1", memberId: "u1", added: [{ id: "r1", name: "Membre" }] }),
    ]),
  });

  await handler.execute(
    makeMember({ id: "u1", nickname: "Alice", roleIds: [], guild }),
    makeMember({ id: "u1", nickname: "Alice", roleIds: ["r1", "r2"], guild }),
  );

  const added = byAction("member_role_added");
  assert.equal(added.length, 2);
  assert.deepEqual(added.map((entry) => entry.roleId).sort(), ["r1", "r2"]);
  assert.equal(byAction("member_nickname_changed").length, 0);
});

test("PHASE1-FIX4: ajout ET retrait dans le même mouvement → 1 log de chaque, 0 pseudo", async () => {
  reset();
  const guild = makeGuild({
    audit: roleAudit([auditRoleEntry({
      id: "E1",
      memberId: "u1",
      added: [{ id: "r2", name: "VIP" }],
      removed: [{ id: "r1", name: "Membre" }],
    })]),
  });

  await handler.execute(
    makeMember({ id: "u1", nickname: "Alice", roleIds: ["r1"], guild }),
    makeMember({ id: "u1", nickname: "Alice", roleIds: ["r2"], guild }),
  );

  assert.equal(byAction("member_role_added").length, 1);
  assert.equal(byAction("member_role_removed").length, 1);
  assert.equal(byAction("member_nickname_changed").length, 0);
});
