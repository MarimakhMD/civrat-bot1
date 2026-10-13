"use strict";

/**
 * PHASE 1 (diagnostic 5) — REPRODUCTION du bug réel signalé sur Discord.
 *
 * SYMPTÔMES observés après le déploiement de d9a8f4e :
 *   • ajout de rôle   → aucun log, `LOG_ROLE_DELTA_UNRESOLVED / NO_MATCHING_ENTRY`,
 *                       `auditAvailable: true` ;
 *   • retrait de rôle → idem ;
 *   • changement de pseudo → fonctionne ;
 *   • timeout → aucun log.
 *
 * CAUSE (prouvée ici contre le VRAI discord.js 14.27) :
 *
 *   `guild.fetchAuditLogs()` renvoie un `GuildAuditLogs` dont `entries` est une
 *   `Collection` (qui ÉTEND `Map`). Or `toEntryArray()` fait :
 *
 *       const list = entries.filter(() => true);        // → une Collection
 *       return Array.isArray(list) ? list : [...list];  // → [...Map] = PAIRES
 *
 *   Étendre une `Map` produit des paires `[clé, valeur]`. Chaque « entrée »
 *   transmise aux gardes est donc le tableau `["1549883910198923264", entry]`
 *   et non l'entrée : `entryTargetId()` y vaut `null`, `entry.changes` y est
 *   `undefined`. TOUTES les entrées sont rejetées, alors que l'entrée réelle
 *   satisfait chacune des gardes prise séparément.
 *
 *   Conséquences : `resolveRoleDeltasDetailed()` renvoie `deltas: []` avec
 *   `available: true` → `NO_MATCHING_ENTRY`. Même effet sur
 *   `resolveTimeoutAction()`, `resolveAuditAction()` (kick, ban, invitations) :
 *   l'auteur n'est jamais résolu.
 *
 * POURQUOI LES 1744 TESTS PASSAIENT :
 *   tous les harnais existants simulent `{ entries: { filter: () => [...] } }`
 *   — un `filter()` qui renvoie un TABLEAU. `Array.isArray(list)` est alors
 *   vrai et la corruption est contournée. Le chemin réel, lui, renvoie une
 *   `Collection`.
 *
 * Les scénarios ci-dessous affirment le comportement ATTENDU : tant que la
 * correction n'est pas appliquée, ceux marqués « ÉCHEC ATTENDU » échouent.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { GuildAuditLogs, Partials, SnowflakeUtil } = require("discord.js");
const { Collection } = require("@discordjs/collection");

const guildConfigService = require("../../src/services/guildConfig");
const getLogsRuntimeModule = require("../../src/modules/logs/runtime/getLogsRuntime");
const auditLogCache = require("../../src/utils/auditLogCache");
const auditLogActor = require("../../src/utils/auditLogActor");
const selfActionRegistry = require("../../src/utils/selfActionRegistry");
const logger = require("../../src/utils/logger");
const handler = require("../../src/events/guildMemberUpdate");

const GUILD_ID = "G1";
const MEMBER_ID = "123456789012345678";
const MODERATOR_ID = "987654321098765432";
const ROLE_ID = "599413442322825226";

// ─────────────────────────────────────────────────────────────
// Payloads REST — forme VERBATIM de GET /guilds/{id}/audit-logs
// ─────────────────────────────────────────────────────────────

/** `id` d'entrée : un snowflake encodant l'instant, comme le fait Discord. */
function snowflake(timestamp) {
  return String(SnowflakeUtil.generate({ timestamp }));
}

function rawAuditLog(entries, { users = "both" } = {}) {
  // Discord inclut les utilisateurs référencés ; `GuildAuditLogs` les verse
  // dans `client.users.cache` AVANT de construire les entrées, ce qui permet
  // de résoudre `entry.executor` même sans `Partials.User`. La CIBLE, elle,
  // n'y figure pas toujours : `entry.target` vaut alors `null`.
  const all = [
    { id: MODERATOR_ID, username: "Moderator", discriminator: "0001", avatar: null, global_name: null },
    { id: MEMBER_ID, username: "alice", discriminator: "0002", avatar: null, global_name: null },
  ];
  return {
    users: users === "moderatorOnly" ? all.slice(0, 1) : all,
    audit_log_entries: entries,
    integrations: [],
    webhooks: [],
    guild_scheduled_events: [],
    threads: [],
    application_commands: [],
    auto_moderation_rules: [],
  };
}

function roleUpdateEntry({ timestamp, added }) {
  return {
    target_id: MEMBER_ID,
    changes: added
      ? [{ key: "$add", new_value: [{ id: ROLE_ID, name: "Muted" }] }]
      : [{ key: "$remove", new_value: [{ id: ROLE_ID, name: "Muted" }] }],
    user_id: MODERATOR_ID,
    id: snowflake(timestamp),
    action_type: 25,
    options: { id: ROLE_ID, type: "0" },
    reason: null,
  };
}

function timeoutEntry({ timestamp, until }) {
  return {
    target_id: MEMBER_ID,
    changes: [{ key: "communication_disabled_until", new_value: new Date(until).toISOString() }],
    user_id: MODERATOR_ID,
    id: snowflake(timestamp),
    action_type: 24,
    options: {},
    reason: "Spam",
  };
}

// ─────────────────────────────────────────────────────────────
// Harnais fidèle
// ─────────────────────────────────────────────────────────────

const sent = [];
const warns = [];
const infos = [];

function fakeLogsRuntime() {
  return {
    handleRoleEvent: async (entry) =>
      sent.push({ action: entry.action, roleId: entry.roleId, memberId: entry.memberId, target: entry.target, who: entry.who }),
    handleMemberNicknameChanged: async (payload) =>
      sent.push({ action: "member_nickname_changed", before: payload.before, after: payload.after }),
    handleModerationEvent: async (entry) =>
      sent.push({
        action: entry.action,
        targetId: entry.targetId,
        moderator: entry.moderator,
        moderatorId: entry.moderatorId,
        reason: entry.reason,
        duration: entry.duration,
      }),
  };
}

/**
 * Guilde dont `fetchAuditLogs` renvoie un VRAI `GuildAuditLogs` — le contrat
 * réel de discord.js. C'est ce que les harnais précédents ne modélisaient pas.
 */
function makeGuild({ rawByType = {} } = {}) {
  const usersCache = new Collection();
  const guild = {
    id: GUILD_ID,
    roles: { cache: new Collection([[ROLE_ID, { id: ROLE_ID, name: "Muted" }]]) },
    scheduledEvents: { _add: (data) => data },
    autoModerationRules: { _add: (data) => data },
    client: {
      // Configuration réelle de CIVRAT (index.js) : `Partials.User` ABSENT.
      options: { partials: [Partials.Message, Partials.Channel, Partials.GuildMember] },
      users: {
        cache: usersCache,
        _add: (data) => {
          const user = { id: data.id, username: data.username, tag: data.username };
          usersCache.set(user.id, user);
          return user;
        },
      },
      channels: { _add: (data) => data },
      guilds: { cache: new Collection() },
    },
  };
  guild.fetchAuditLogs = async ({ type }) => {
    const raw = rawByType[type];
    if (!raw) return new GuildAuditLogs(guild, rawAuditLog([]));
    return new GuildAuditLogs(guild, raw);
  };
  return guild;
}

function makeMember({ nickname = null, roleIds = [], timeout = null, partial = false, guild }) {
  const member = {
    id: MEMBER_ID,
    guild,
    partial,
    joinedTimestamp: partial ? null : Date.now(),
    nickname,
    communicationDisabledUntilTimestamp: timeout,
    _roles: roleIds.slice(),
    user: { id: MEMBER_ID, tag: "alice", displayAvatarURL: () => null },
  };
  Object.defineProperty(member, "roles", {
    get() {
      const cache = new Map();
      cache.set(GUILD_ID, { id: GUILD_ID, name: "@everyone" });
      for (const roleId of member._roles) {
        const role = guild.roles.cache.get(roleId);
        if (role) cache.set(roleId, role);
      }
      return { cache };
    },
  });
  return member;
}

function reset() {
  sent.length = 0;
  warns.length = 0;
  infos.length = 0;
  auditLogCache._clearCache();
  auditLogActor._resetConsumed();
  selfActionRegistry._clearSelfActions();
  logger.warn = (...args) => warns.push(args[1] || { message: args[0] });
  logger.info = (...args) => infos.push(args[1] || { message: args[0] });
  getLogsRuntimeModule.getLogsRuntime = fakeLogsRuntime;
  guildConfigService.getGuildConfig = async () => ({
    logs_enabled: true,
    language: "fr",
    log_role_update_channel_id: "c-role",
    log_moderation_channel_id: "c-mod",
  });
}

const byAction = (action) => sent.filter((entry) => entry.action === action);

// ─────────────────────────────────────────────────────────────
// Le mécanisme, isolé
// ─────────────────────────────────────────────────────────────

test("DIAG5: readAuditLog rend les ENTRÉES d'audit, pas des paires [id, entrée]", async () => {
  reset();
  const guild = makeGuild({ rawByType: { 25: rawAuditLog([roleUpdateEntry({ timestamp: Date.now(), added: true })]) } });

  const { entries, available } = await auditLogCache.readAuditLog(guild, 25);

  assert.equal(available, true);
  assert.equal(entries.length, 1);
  // ÉCHEC ATTENDU tant que `toEntryArray` étend la Collection.
  assert.equal(Array.isArray(entries[0]), false, "une entrée d'audit n'est pas un tableau [clé, valeur]");
  assert.equal(typeof entries[0].id, "string");
  assert.equal(String(entries[0].targetId), MEMBER_ID);
  assert.ok(Array.isArray(entries[0].changes), "entry.changes doit être accessible");
});

test("DIAG5: l'entrée RÉELLE satisfait chaque garde prise séparément", async () => {
  reset();
  const now = Date.now();
  const guild = makeGuild({ rawByType: { 25: rawAuditLog([roleUpdateEntry({ timestamp: now, added: true })]) } });

  const logs = await guild.fetchAuditLogs({ type: 25, limit: 25 });
  const real = logs.entries.first(); // ce que l'ancien `limit: 1` utilisait

  assert.equal(auditLogActor.entryTargetId(real), MEMBER_ID);
  assert.equal(auditLogActor.matchesTarget(real, MEMBER_ID, null), true);
  assert.deepEqual(auditLogActor.roleDelta(real.changes).added, [{ id: ROLE_ID, name: "Muted" }]);
  assert.equal(auditLogActor.isFresh(real, now), true);
  // La corruption ne vient donc d'aucune garde : elle précède leur évaluation.
});

// ─────────────────────────────────────────────────────────────
// Les 5 scénarios demandés, séparément
// ─────────────────────────────────────────────────────────────

test("DIAG5: ajout de rôle → 1 log « rôle ajouté » avec son auteur", async () => {
  reset();
  const now = Date.now();
  const guild = makeGuild({ rawByType: { 25: rawAuditLog([roleUpdateEntry({ timestamp: now, added: true })]) } });

  await handler.execute(
    makeMember({ nickname: "Alice", roleIds: [], guild }),
    makeMember({ nickname: "Alice", roleIds: [ROLE_ID], guild }),
  );

  assert.equal(byAction("member_role_added").length, 1, `logs émis : ${JSON.stringify(sent)} / warns : ${JSON.stringify(warns)}`);
  assert.equal(byAction("member_role_added")[0].roleId, ROLE_ID);
  assert.equal(byAction("member_role_added")[0].memberId, MEMBER_ID);
  assert.equal(byAction("member_role_added")[0].who, `Moderator (${MODERATOR_ID})`);
  assert.equal(byAction("member_nickname_changed").length, 0);
  assert.equal(warns.filter((w) => w.event === "LOG_ROLE_DELTA_UNRESOLVED").length, 0);
});

test("DIAG5: retrait de rôle → 1 log « rôle retiré » avec son auteur", async () => {
  reset();
  const now = Date.now();
  const guild = makeGuild({ rawByType: { 25: rawAuditLog([roleUpdateEntry({ timestamp: now, added: false })]) } });

  await handler.execute(
    makeMember({ nickname: "Alice", roleIds: [ROLE_ID], guild }),
    makeMember({ nickname: "Alice", roleIds: [], guild }),
  );

  assert.equal(byAction("member_role_removed").length, 1, `logs émis : ${JSON.stringify(sent)} / warns : ${JSON.stringify(warns)}`);
  assert.equal(byAction("member_role_removed")[0].roleId, ROLE_ID);
  assert.equal(byAction("member_role_removed")[0].who, `Moderator (${MODERATOR_ID})`);
  assert.equal(byAction("member_role_added").length, 0);
});

test("DIAG5: timeout → 1 log de modération avec auteur, raison et durée", async () => {
  reset();
  const now = Date.now();
  const until = now + 600_000;
  const guild = makeGuild({ rawByType: { 24: rawAuditLog([timeoutEntry({ timestamp: now, until })]) } });

  await handler.execute(
    makeMember({ nickname: "Alice", roleIds: [ROLE_ID], timeout: null, guild }),
    makeMember({ nickname: "Alice", roleIds: [ROLE_ID], timeout: until, guild }),
  );

  assert.equal(byAction("member_timed_out").length, 1, `logs émis : ${JSON.stringify(sent)}`);
  const log = byAction("member_timed_out")[0];
  assert.equal(log.targetId, MEMBER_ID);
  assert.equal(log.duration, "10 min");
  // ÉCHEC ATTENDU : l'auteur n'est jamais résolu (même corruption).
  assert.equal(log.moderatorId, MODERATOR_ID);
  assert.equal(log.moderator, `Moderator (${MODERATOR_ID})`);
  assert.equal(log.reason, "Spam");
});

test("DIAG5: pseudo → 1 log de pseudo (chemin sans Audit Log : déjà correct)", async () => {
  reset();
  const guild = makeGuild();

  await handler.execute(
    makeMember({ nickname: "Alice", roleIds: [ROLE_ID], guild }),
    makeMember({ nickname: "Bob", roleIds: [ROLE_ID], guild }),
  );

  assert.equal(byAction("member_nickname_changed").length, 1);
  assert.equal(byAction("member_nickname_changed")[0].before, "Alice");
  assert.equal(byAction("member_nickname_changed")[0].after, "Bob");
  assert.equal(byAction("member_role_added").length, 0);
  assert.equal(byAction("member_role_removed").length, 0);
});

test("DIAG5: membre partiel + ajout de rôle → 1 log de rôle, 0 pseudo inventé", async () => {
  reset();
  const now = Date.now();
  const guild = makeGuild({ rawByType: { 25: rawAuditLog([roleUpdateEntry({ timestamp: now, added: true })]) } });

  await handler.execute(
    makeMember({ nickname: null, roleIds: [], partial: true, guild }),
    makeMember({ nickname: "Alice", roleIds: [ROLE_ID], guild }),
  );

  assert.equal(byAction("member_nickname_changed").length, 0, "l'état « avant » d'un membre partiel n'est pas fiable");
  assert.equal(byAction("member_role_added").length, 1, `logs émis : ${JSON.stringify(sent)} / warns : ${JSON.stringify(warns)}`);
  assert.equal(byAction("member_role_added")[0].roleId, ROLE_ID);
});

// ─────────────────────────────────────────────────────────────
// Cible absente de `data.users` — `entry.target` vaut alors `null`
// ─────────────────────────────────────────────────────────────

const warnEvents = () => warns.map((entry) => entry.event);
const infoEvents = () => infos.map((entry) => entry.event);

test("DIAG5: cible absente de data.users → entry.target vaut null", async () => {
  reset();
  const guild = makeGuild({ rawByType: { 25: rawAuditLog([roleUpdateEntry({ timestamp: Date.now(), added: true })], { users: "moderatorOnly" }) } });

  const logs = await guild.fetchAuditLogs({ type: 25, limit: 25 });
  const entry = logs.entries.first();

  assert.equal(entry.target, null, "sans Partials.User ni entrée en cache, la cible n'est pas résolue");
  assert.equal(entry.targetId, MEMBER_ID, "targetId vient du payload brut et reste renseigné");
  assert.equal(entry.executor.id, MODERATOR_ID, "l'auteur, lui, figure dans data.users");
});

test("DIAG5: cible absente de data.users → le rôle est quand même journalisé", async () => {
  reset();
  const now = Date.now();
  const guild = makeGuild({ rawByType: { 25: rawAuditLog([roleUpdateEntry({ timestamp: now, added: true })], { users: "moderatorOnly" }) } });

  await handler.execute(
    makeMember({ nickname: "Alice", roleIds: [], guild }),
    makeMember({ nickname: "Alice", roleIds: [ROLE_ID], guild }),
  );

  assert.equal(byAction("member_role_added").length, 1, `logs émis : ${JSON.stringify(sent)} / warns : ${JSON.stringify(warns)}`);
  assert.equal(byAction("member_role_added")[0].who, `Moderator (${MODERATOR_ID})`);
  assert.equal(byAction("member_role_added")[0].roleId, ROLE_ID);
});

// ─────────────────────────────────────────────────────────────
// Chemin timeout : plus aucune sortie silencieuse
// ─────────────────────────────────────────────────────────────

test("DIAG5: timeout sans entrée d'audit → le log part, avec un diagnostic", async () => {
  reset();
  const now = Date.now();
  const until = now + 600_000;
  const guild = makeGuild({ rawByType: {} }); // aucun type 24 disponible

  await handler.execute(
    makeMember({ nickname: "Alice", roleIds: [ROLE_ID], timeout: null, guild }),
    makeMember({ nickname: "Alice", roleIds: [ROLE_ID], timeout: until, guild }),
  );

  // Le timeout a bien eu lieu : l'événement gateway le dit. Seul l'auteur manque.
  assert.equal(byAction("member_timed_out").length, 1, `logs émis : ${JSON.stringify(sent)}`);
  assert.equal(byAction("member_timed_out")[0].moderatorId, null, "aucune identité inventée");
  assert.ok(warnEvents().includes("LOG_TIMEOUT_UNRESOLVED"), `warns : ${JSON.stringify(warns)}`);
  assert.equal(warns.find((w) => w.event === "LOG_TIMEOUT_UNRESOLVED").reason, "NO_MATCHING_ENTRY");
});

test("DIAG5: timeout appliqué par le bot → pas de second log, mais une trace", async () => {
  reset();
  const now = Date.now();
  const until = now + 600_000;
  const guild = makeGuild({ rawByType: { 24: rawAuditLog([timeoutEntry({ timestamp: now, until })]) } });

  // AutoMod a déjà journalisé la sanction : l'événement secondaire s'abstient.
  selfActionRegistry.markSelfAction("timeout", guild.id, MEMBER_ID);

  await handler.execute(
    makeMember({ nickname: "Alice", roleIds: [ROLE_ID], timeout: null, guild }),
    makeMember({ nickname: "Alice", roleIds: [ROLE_ID], timeout: until, guild }),
  );

  assert.equal(byAction("member_timed_out").length, 0, `logs émis : ${JSON.stringify(sent)}`);
  assert.ok(infoEvents().includes("LOG_TIMEOUT_SELF_ACTION"), `infos : ${JSON.stringify(infos)}`);
});

test("DIAG5: timeout prolongé → rien d'inventé, mais une trace", async () => {
  reset();
  const now = Date.now();
  const guild = makeGuild({ rawByType: {} });

  await handler.execute(
    makeMember({ nickname: "Alice", roleIds: [ROLE_ID], timeout: now + 300_000, guild }),
    makeMember({ nickname: "Alice", roleIds: [ROLE_ID], timeout: now + 900_000, guild }),
  );

  assert.equal(byAction("member_timed_out").length, 0);
  assert.equal(byAction("member_untimeout").length, 0);
  assert.ok(warnEvents().includes("LOG_TIMEOUT_TRANSITION_UNKNOWN"), `warns : ${JSON.stringify(warns)}`);
});
