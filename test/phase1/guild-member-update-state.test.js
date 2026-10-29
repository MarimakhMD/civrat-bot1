"use strict";

/**
 * PHASE 1 (correctif 1) — `guildMemberUpdate` doit journaliser l'état de SON
 * événement, jamais celui d'un événement ultérieur.
 *
 * discord.js émet `guildMemberUpdate(old, member)` où `member` est l'objet
 * VIVANT du cache : tout `GUILD_MEMBER_UPDATE` suivant le repatche. L'ancienne
 * version calculait `nicknameChanged` APRÈS `await getGuildConfig(...)` et
 * relisait encore ces objets 1000 ms plus tard — d'où le `Nickname changed`
 * fantôme sur un simple ajout de rôle, et la valeur « Après » erronée.
 *
 * Ces tests pilotent le VRAI handler avec une sémantique fidèle à discord.js :
 * `oldMember` est un instantané, `newMember` est mutable et repatché en vol.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const guildConfigService = require("../../src/services/guildConfig");
const getLogsRuntimeModule = require("../../src/modules/logs/runtime/getLogsRuntime");
const auditLogCache = require("../../src/utils/auditLogCache");
const auditLogActor = require("../../src/utils/auditLogActor");
const selfActionRegistry = require("../../src/utils/selfActionRegistry");
const logger = require("../../src/utils/logger");

const handler = require("../../src/events/guildMemberUpdate");
const { captureMemberUpdate } = handler;

// ─────────────────────────────────────────────────────────────
// Harnais
// ─────────────────────────────────────────────────────────────

const sent = [];
const warns = [];

function fakeLogsRuntime() {
  return {
    handleRoleEvent: async (entry) => { sent.push({ action: entry.action, roleId: entry.roleId, memberId: entry.memberId, member: entry.member, who: entry.who }); },
    handleMemberNicknameChanged: async (payload) => { sent.push({ action: "member_nickname_changed", ...payload }); },
    handleModerationEvent: async (entry) => { sent.push({ action: entry.action, target: entry.target, duration: entry.duration, moderator: entry.moderator }); },
  };
}

/** Membre fidèle à discord.js : `roles.cache` = @everyone + `_roles` résolus. */
function makeMember({ id, nickname = null, roleIds = [], timeout = null, guild }) {
  const member = {
    id,
    guild,
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

function makeGuild({ roles = {}, audit = async () => ({ entries: { filter: () => [] } }) } = {}) {
  const guild = { id: "G1", roles: { cache: new Map(Object.entries(roles)) } };
  guild.fetchAuditLogs = audit;
  return guild;
}

function roleEntry({ id, memberId, added = [], removed = [], executor = { id: "bot", tag: "CIVRAT" }, ageMs = 400 }) {
  const changes = [];
  if (added.length > 0) changes.push({ key: "$add", new: added });
  if (removed.length > 0) changes.push({ key: "$remove", new: removed });
  return { id, target: { id: memberId }, executor, createdAt: new Date(Date.now() - ageMs), changes };
}

function reset({ config, onConfigRead } = {}) {
  sent.length = 0;
  warns.length = 0;
  auditLogCache._clearCache();
  auditLogActor._resetConsumed();
  selfActionRegistry._clearSelfActions();
  logger.warn = (...args) => warns.push(args[1] || { message: args[0] });
  getLogsRuntimeModule.getLogsRuntime = fakeLogsRuntime;
  guildConfigService.getGuildConfig = async () => {
    if (onConfigRead) onConfigRead();
    return config || { logs_enabled: true, language: "fr", log_role_update_channel_id: "c", log_moderation_channel_id: "c" };
  };
}

const ROLES = { r1: { id: "r1", name: "Membre" }, r2: { id: "r2", name: "VIP" } };

// ─────────────────────────────────────────────────────────────
// Capture d'état (unitaire)
// ─────────────────────────────────────────────────────────────

test("PHASE1-FIX1: un changement de rôle seul n'est pas un changement de pseudo", () => {
  const guild = makeGuild({ roles: ROLES });
  const event = captureMemberUpdate(
    makeMember({ id: "u1", nickname: null, roleIds: [], guild }),
    makeMember({ id: "u1", nickname: null, roleIds: ["r1"], guild }),
  );
  assert.equal(event.rolesChanged, true);
  assert.equal(event.nicknameChanged, false);
  assert.equal(event.timeoutChanged, false);
});

test("PHASE1-FIX1: undefined / null / \"\" sont la même réalité « pas de pseudo »", () => {
  const guild = makeGuild({ roles: ROLES });
  const pairs = [[undefined, null], [null, undefined], [undefined, ""], ["", null], [null, null]];
  for (const [before, after] of pairs) {
    const event = captureMemberUpdate(
      makeMember({ id: "u1", nickname: before, guild }),
      makeMember({ id: "u1", nickname: after, guild }),
    );
    assert.equal(event.nicknameChanged, false, `${String(before)} → ${String(after)} ne doit pas être un changement`);
  }
});

test("PHASE1-FIX1: un pseudo réel est détecté avec ses valeurs exactes", () => {
  const guild = makeGuild({ roles: ROLES });
  const event = captureMemberUpdate(
    makeMember({ id: "u1", nickname: "Alice", guild }),
    makeMember({ id: "u1", nickname: "Bob", guild }),
  );
  assert.equal(event.nicknameChanged, true);
  assert.equal(event.beforeNickname, "Alice");
  assert.equal(event.afterNickname, "Bob");
  assert.equal(event.memberId, "u1");
});

test("PHASE1-FIX1: l'état capturé est figé (non mutable)", () => {
  const guild = makeGuild({ roles: ROLES });
  const event = captureMemberUpdate(
    makeMember({ id: "u1", nickname: "Alice", guild }),
    makeMember({ id: "u1", nickname: "Bob", guild }),
  );
  assert.throws(() => { event.afterNickname = "Charlie"; }, "l'état d'événement doit être en lecture seule");
});

test("PHASE1-FIX1: un timeout invalide ne devient pas un changement", () => {
  const guild = makeGuild({ roles: ROLES });
  const event = captureMemberUpdate(
    makeMember({ id: "u1", timeout: undefined, guild }),
    makeMember({ id: "u1", timeout: null, guild }),
  );
  assert.equal(event.timeoutChanged, false);
  assert.equal(event.beforeTimeout, null);
  assert.equal(event.afterTimeout, null);
});

// ─────────────────────────────────────────────────────────────
// Concurrence : mutation de l'objet vivant pendant l'await
// ─────────────────────────────────────────────────────────────

test("PHASE1-FIX1: rôle seul + mutation du membre vivant pendant la lecture de config → 0 log de pseudo", async () => {
  reset({
    // La lecture de configuration est le point d'await : un second
    // GUILD_MEMBER_UPDATE repatche l'objet VIVANT pendant ce temps.
    onConfigRead: () => { liveMember.nickname = null; },
  });
  const guild = makeGuild({ roles: ROLES });
  const oldMember = makeMember({ id: "u1", nickname: "Alice", roleIds: [], guild });
  const liveMember = makeMember({ id: "u1", nickname: "Alice", roleIds: ["r1"], guild });

  await handler.execute(oldMember, liveMember);

  const nicknameLogs = sent.filter((entry) => entry.action === "member_nickname_changed");
  assert.equal(nicknameLogs.length, 0, "un ajout de rôle ne doit jamais produire de log de pseudo");
});

test("PHASE1-FIX1: pseudo réel + mutation ultérieure → valeurs de CET événement", async () => {
  reset({
    onConfigRead: () => { liveMember.nickname = "Charlie"; },
  });
  const guild = makeGuild({ roles: ROLES });
  const oldMember = makeMember({ id: "u1", nickname: "Alice", guild });
  const liveMember = makeMember({ id: "u1", nickname: "Bob", guild });

  await handler.execute(oldMember, liveMember);

  const nicknameLogs = sent.filter((entry) => entry.action === "member_nickname_changed");
  assert.equal(nicknameLogs.length, 1);
  assert.equal(nicknameLogs[0].before, "Alice");
  assert.equal(nicknameLogs[0].after, "Bob", "la valeur « Après » doit être celle de l'événement, pas une modification ultérieure");
});

test("PHASE1-FIX1: timeout réel + expiration de l'objet vivant → valeurs de CET événement", async () => {
  const until = Date.now() + 600_000;
  reset({
    onConfigRead: () => { liveMember.communicationDisabledUntilTimestamp = null; },
  });
  const guild = makeGuild({ roles: ROLES });
  const oldMember = makeMember({ id: "u1", timeout: null, guild });
  const liveMember = makeMember({ id: "u1", timeout: until, guild });

  await handler.execute(oldMember, liveMember);

  const timeoutLogs = sent.filter((entry) => entry.action === "member_timed_out");
  assert.equal(timeoutLogs.length, 1, "le timeout doit être journalisé malgré la mutation ultérieure de l'objet");
  assert.equal(typeof timeoutLogs[0].duration, "string");
  assert.match(timeoutLogs[0].duration, /^\d+ min$/);
});

test("PHASE1-FIX1: plusieurs événements rapprochés gardent chacun leur état", async () => {
  reset();
  const guild = makeGuild({ roles: ROLES });

  // Deux membres modifiés en même temps, avec des pseudos différents.
  const first = {
    old: makeMember({ id: "u1", nickname: "Alice", guild }),
    live: makeMember({ id: "u1", nickname: "Alicia", guild }),
  };
  const second = {
    old: makeMember({ id: "u2", nickname: "Bob", guild }),
    live: makeMember({ id: "u2", nickname: "Bobby", guild }),
  };

  await Promise.all([
    handler.execute(first.old, first.live),
    handler.execute(second.old, second.live),
  ]);

  const nicknameLogs = sent.filter((entry) => entry.action === "member_nickname_changed");
  assert.equal(nicknameLogs.length, 2);
  const byMember = Object.fromEntries(nicknameLogs.map((entry) => [entry.memberId, entry]));
  assert.equal(byMember.u1.before, "Alice");
  assert.equal(byMember.u1.after, "Alicia");
  assert.equal(byMember.u2.before, "Bob");
  assert.equal(byMember.u2.after, "Bobby", "aucun événement ne doit hériter de l'état d'un autre");
});

// ─────────────────────────────────────────────────────────────
// Chaîne de rôles : attribution, concours, diagnostic
// ─────────────────────────────────────────────────────────────

test("PHASE1-FIX2: une attribution de rôle produit exactement 1 log, bon rôle, bon membre, bon auteur", async () => {
  reset();
  const guild = makeGuild({
    roles: ROLES,
    audit: async () => ({
      entries: { filter: () => [roleEntry({ id: "E1", memberId: "u1", added: [{ id: "r1", name: "Membre" }] })] },
    }),
  });

  await handler.execute(
    makeMember({ id: "u1", roleIds: [], guild }),
    makeMember({ id: "u1", roleIds: ["r1"], guild }),
  );

  const roleLogs = sent.filter((entry) => entry.action === "member_role_added");
  assert.equal(roleLogs.length, 1, "exactement un log par rôle ajouté");
  assert.equal(roleLogs[0].roleId, "r1");
  assert.equal(roleLogs[0].memberId, "u1");
  assert.equal(roleLogs[0].who, "CIVRAT (bot)");
});

test("PHASE1-FIX2: plusieurs membres recevant un rôle en même temps → aucun log perdu", async () => {
  reset();
  const guild = makeGuild({
    roles: ROLES,
    audit: async () => ({
      entries: {
        filter: () => [
          roleEntry({ id: "E2", memberId: "u2", added: [{ id: "r1", name: "Membre" }], executor: { id: "bot", tag: "CIVRAT" } }),
          roleEntry({ id: "E1", memberId: "u1", added: [{ id: "r1", name: "Membre" }], executor: { id: "bot", tag: "CIVRAT" } }),
        ],
      },
    }),
  });

  await Promise.all([
    handler.execute(makeMember({ id: "u1", roleIds: [], guild }), makeMember({ id: "u1", roleIds: ["r1"], guild })),
    handler.execute(makeMember({ id: "u2", roleIds: [], guild }), makeMember({ id: "u2", roleIds: ["r1"], guild })),
  ]);

  const roleLogs = sent.filter((entry) => entry.action === "member_role_added");
  assert.equal(roleLogs.length, 2, "un log par membre, aucun perdu");
  assert.deepEqual(roleLogs.map((entry) => entry.memberId).sort(), ["u1", "u2"]);
});

test("PHASE1-FIX2: deux attributions rapprochées du même membre → 2 logs, aucun doublon", async () => {
  reset();
  const guild = makeGuild({
    roles: ROLES,
    audit: async () => ({
      entries: {
        filter: () => [
          roleEntry({ id: "E2", memberId: "u1", added: [{ id: "r2", name: "VIP" }] }),
          roleEntry({ id: "E1", memberId: "u1", added: [{ id: "r1", name: "Membre" }] }),
        ],
      },
    }),
  });

  await handler.execute(
    makeMember({ id: "u1", roleIds: [], guild }),
    makeMember({ id: "u1", roleIds: ["r1", "r2"], guild }),
  );

  const roleLogs = sent.filter((entry) => entry.action === "member_role_added");
  assert.equal(roleLogs.length, 2);
  assert.deepEqual(roleLogs.map((entry) => entry.roleId).sort(), ["r1", "r2"], "ordre chronologique, un log par entrée");
});

test("PHASE1-FIX2: Audit Log illisible → aucun log inventé, mais un diagnostic observable", async () => {
  reset();
  const guild = makeGuild({
    roles: ROLES,
    audit: async () => {
      const error = new Error("Missing Permissions");
      error.code = 50013;
      throw error;
    },
  });

  await handler.execute(
    makeMember({ id: "u1", roleIds: [], guild }),
    makeMember({ id: "u1", roleIds: ["r1"], guild }),
  );

  assert.equal(sent.filter((entry) => entry.action === "member_role_added").length, 0, "rien n'est inventé");

  const unresolved = warns.filter((entry) => entry.event === "LOG_ROLE_DELTA_UNRESOLVED");
  assert.equal(unresolved.length, 1, "l'absence doit être visible");
  assert.equal(unresolved[0].auditAvailable, false);
  assert.equal(unresolved[0].reason, "MISSING_PERMISSIONS");

  const readFailed = warns.filter((entry) => entry.event === "AUDIT_LOG_READ_FAILED");
  assert.equal(readFailed.length, 1);
  assert.equal(readFailed[0].reason, "MISSING_PERMISSIONS");
});

test("PHASE1-FIX2: entrées présentes mais non corrélables → diagnostic NO_MATCHING_ENTRY", async () => {
  reset();
  const guild = makeGuild({
    roles: ROLES,
    // Entrée d'un AUTRE membre : rien d'attribuable à u1.
    audit: async () => ({ entries: { filter: () => [roleEntry({ id: "E9", memberId: "u9", added: [{ id: "r1", name: "Membre" }] })] } }),
  });

  await handler.execute(
    makeMember({ id: "u1", roleIds: [], guild }),
    makeMember({ id: "u1", roleIds: ["r1"], guild }),
  );

  assert.equal(sent.length, 0);
  const unresolved = warns.filter((entry) => entry.event === "LOG_ROLE_DELTA_UNRESOLVED");
  assert.equal(unresolved.length, 1);
  assert.equal(unresolved[0].auditAvailable, true, "la lecture a réussi : ce n'est pas une panne");
  assert.equal(unresolved[0].reason, "NO_MATCHING_ENTRY");
});

test("PHASE1-FIX2: logs désactivés → aucune lecture d'audit", async () => {
  let auditCalls = 0;
  reset({ config: { logs_enabled: false } });
  const guild = makeGuild({
    roles: ROLES,
    audit: async () => { auditCalls += 1; return { entries: { filter: () => [] } }; },
  });

  await handler.execute(
    makeMember({ id: "u1", roleIds: [], guild }),
    makeMember({ id: "u1", roleIds: ["r1"], guild }),
  );

  assert.equal(auditCalls, 0, "aucune requête API pour un log qui sera jeté");
  assert.equal(sent.length, 0);
});
