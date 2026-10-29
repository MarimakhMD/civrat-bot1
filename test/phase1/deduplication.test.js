"use strict";

/**
 * PHASE 1 — déduplication : 1 action réelle = 1 log métier.
 *
 * Ces tests pilotent les VRAIS écouteurs d'événements et le VRAI runtime de
 * logs (mapper → résolution du salon → transport → embed). Seuls la
 * configuration de guilde, le transport Discord et les dépôts sont des doubles.
 *
 * Convention de lecture : un kick produit un log dans « membres » (le membre
 * n'est plus sur le serveur) ET un log dans « modération » (la sanction, avec
 * son auteur et sa raison). Ce sont deux faits distincts, dans deux salons
 * distincts — pas un doublon. Le doublon corrigé ici, c'est le second log de
 * SANCTION, ou le log fantôme émis sans aucune sanction réelle.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const guildConfigModule = require("../../src/services/guildConfig");
const inviteService = require("../../src/services/inviteService");
const { _clearCache } = require("../../src/utils/auditLogCache");
const { _resetConsumed } = require("../../src/utils/auditLogActor");
const { _clearSelfActions } = require("../../src/utils/selfActionRegistry");

const originalGetGuildConfig = guildConfigModule.getGuildConfig;
const originalRevokeInvite = inviteService.revokeInvite;

// ─────────────────────────────────────────────────────────────
// Doubles
// ─────────────────────────────────────────────────────────────

function makeConfig(overrides = {}) {
  return {
    logs_enabled: true,
    language: "fr",
    log_member_join_channel_id: "CH_JOIN",
    log_member_leave_channel_id: "CH_LEAVE",
    log_moderation_channel_id: "CH_MOD",
    log_role_update_channel_id: "CH_ROLE",
    log_channel_update_channel_id: "CH_CHAN",
    log_message_delete_channel_id: "CH_MSG",
    log_message_edit_channel_id: "CH_EDIT",
    invitations_log_channel_id: "CH_INVITE",
    ...overrides,
  };
}

/** Guilde Discord de test : salons enregistrant les embeds envoyés. */
function makeGuild(guildId, auditEntries = []) {
  const sent = [];
  const channelIds = ["CH_JOIN", "CH_LEAVE", "CH_MOD", "CH_ROLE", "CH_CHAN", "CH_MSG", "CH_EDIT", "CH_INVITE"];
  const cache = new Map();
  for (const id of channelIds) {
    cache.set(id, { id, isTextBased: () => true, send: async (payload) => { sent.push({ channelId: id, embed: payload.embeds[0].toJSON() }); return { id: "SENT" }; } });
  }
  const guild = {
    id: guildId,
    name: "Serveur de test",
    memberCount: 42,
    channels: { cache },
    fetchAuditLogs: async ({ type, limit }) => {
      const list = auditEntries.filter((entry) => entry.__type === type);
      return { entries: { filter: () => list.slice(0, limit) } };
    },
  };
  guild.__sent = sent;
  return guild;
}

function makeMember(guild, id, overrides = {}) {
  return {
    id,
    guild,
    user: { id, tag: `user_${id}`, bot: false, createdAt: new Date("2024-01-01"), displayAvatarURL: () => `https://cdn.discord/avatars/${id}.png` },
    nickname: null,
    communicationDisabledUntilTimestamp: null,
    roles: { cache: new Map([["@everyone", { id: "@everyone" }]]) },
    ...overrides,
  };
}

function auditEntry({ id, type, targetId, executorId = "M1", executorTag = "Modo", reason = null, changes = null, ageMs = 0 }) {
  const entry = {
    __type: type,
    id,
    target: { id: targetId },
    executor: { id: executorId, tag: executorTag },
    reason,
    createdAt: new Date(Date.now() - ageMs),
  };
  if (changes) entry.changes = changes;
  return entry;
}

/** Réinitialise caches d'audit, registre de consommation et config. */
function reset(config) {
  _clearCache();
  _resetConsumed();
  _clearSelfActions();
  guildConfigModule.getGuildConfig = async () => config;
  inviteService.revokeInvite = async () => ({ revoked: true });
}

function actionsOf(guild) {
  return guild.__sent.map((item) => ({ action: actionFromTitle(item.embed.title), channelId: item.channelId, title: item.embed.title }));
}

/** L'action métier est identifiable par son salon de destination + son titre. */
function actionFromTitle(title) {
  return title;
}

test.before(() => {
  // Le runtime de logs est un singleton construit au premier appel : on force
  // sa reconstruction avec la config de test.
  delete require.cache[require.resolve("../../src/modules/logs/runtime/getLogsRuntime")];
});

test.after(() => {
  guildConfigModule.getGuildConfig = originalGetGuildConfig;
  inviteService.revokeInvite = originalRevokeInvite;
  _clearCache();
  _resetConsumed();
  _clearSelfActions();
});

// ─────────────────────────────────────────────────────────────
// Départ volontaire vs expulsion
// ─────────────────────────────────────────────────────────────

test("PHASE1: un départ volontaire produit exactement UN log (membres), jamais d'expulsion fantôme", async () => {
  const config = makeConfig();
  reset(config);
  const { getLogsRuntime } = require("../../src/modules/logs/runtime/getLogsRuntime");
  delete require.cache[require.resolve("../../src/modules/logs/runtime/getLogsRuntime")];

  const guild = makeGuild("g-voluntary", []);
  reset(config);
  const guildMemberRemove = require("../../src/events/guildMemberRemove");
  const member = makeMember(guild, "U1");

  await guildMemberRemove.execute(member);
  await new Promise((resolve) => setTimeout(resolve, 1700));

  const titles = guild.__sent.map((item) => item.embed.title);
  assert.equal(guild.__sent.length, 1, `un seul log attendu, obtenu : ${titles.join(" | ")}`);
  assert.equal(guild.__sent[0].channelId, "CH_LEAVE", "le départ part dans le salon « membres »");
  assert.equal(titles.some((title) => /expuls/i.test(title)), false, "aucune expulsion fantôme");
  assert.ok(getLogsRuntime, "runtime disponible");
});

test("PHASE1: un kick réel produit le log de sanction, une seule fois", async () => {
  const config = makeConfig();
  const guild = makeGuild("g-real-kick", [
    auditEntry({ id: "E-KICK", type: 20, targetId: "U1", reason: "insultes" }),
  ]);
  reset(config);

  const guildMemberRemove = require("../../src/events/guildMemberRemove");
  await guildMemberRemove.execute(makeMember(guild, "U1"));
  await new Promise((resolve) => setTimeout(resolve, 1700));

  const moderation = guild.__sent.filter((item) => item.channelId === "CH_MOD");
  assert.equal(moderation.length, 1, "exactement un log de modération");
  const fields = moderation[0].embed.fields.map((field) => field.name);
  assert.ok(fields.includes("🛡️ Modérateur"), "l'auteur est renseigné");
  assert.ok(fields.includes("💬 Raison"), "la raison est renseignée");
});

test("PHASE1: kick puis retour puis départ volontaire → uniquement « Membre »", async () => {
  const config = makeConfig();
  // L'entrée de kick existe toujours dans l'audit, mais elle a déjà été
  // consommée par le premier départ.
  const guild = makeGuild("g-kick-back", [
    auditEntry({ id: "E-KICK-1", type: 20, targetId: "U1", reason: "ancienne raison" }),
  ]);
  reset(config);
  const guildMemberRemove = require("../../src/events/guildMemberRemove");

  // 1er départ : le kick.
  await guildMemberRemove.execute(makeMember(guild, "U1"));
  await new Promise((resolve) => setTimeout(resolve, 1700));
  const afterKick = guild.__sent.length;
  assert.ok(afterKick >= 2, "départ + sanction");

  // Retour, puis départ volontaire : plus aucune sanction ne doit être émise.
  guild.__sent.length = 0;
  _clearCache(); // simule le rafraîchissement du cache d'audit
  await guildMemberRemove.execute(makeMember(guild, "U1"));
  await new Promise((resolve) => setTimeout(resolve, 1700));

  assert.equal(guild.__sent.length, 1, `un seul log attendu, obtenu ${guild.__sent.length}`);
  assert.equal(guild.__sent[0].channelId, "CH_LEAVE");
  const values = guild.__sent[0].embed.fields.map((field) => field.value).join(" ");
  assert.equal(values.includes("ancienne raison"), false, "l'ancienne raison ne doit jamais resservir");
});

test("PHASE1: un ban produit « Bannissement » mais jamais « Expulsion »", async () => {
  const config = makeConfig();
  const guild = makeGuild("g-ban", [
    // Discord écrit MemberBanAdd (22), pas MemberKick (20).
    auditEntry({ id: "E-BAN", type: 22, targetId: "U1", reason: "raid" }),
  ]);
  reset(config);

  const guildBanAdd = require("../../src/events/guildBanAdd");
  const guildMemberRemove = require("../../src/events/guildMemberRemove");

  await guildBanAdd.execute({ guild, user: { id: "U1", tag: "user_U1", displayAvatarURL: () => null }, reason: null });
  await guildMemberRemove.execute(makeMember(guild, "U1"));
  await new Promise((resolve) => setTimeout(resolve, 1700));

  const moderation = guild.__sent.filter((item) => item.channelId === "CH_MOD");
  assert.equal(moderation.length, 1, `un seul log de sanction, obtenu ${moderation.length}`);
  assert.match(moderation[0].embed.title, /banni/i);
  // La raison vient de l'audit puisque GuildBan.reason était null.
  assert.ok(moderation[0].embed.fields.some((field) => field.value === "raid"), "la raison est reprise de l'audit");
});

// ─────────────────────────────────────────────────────────────
// Timeout, pseudo, rôles
// ─────────────────────────────────────────────────────────────

test("PHASE1: /mute produit exactement UN log de timeout, corrélé à la bonne entrée", async () => {
  const config = makeConfig();
  const guild = makeGuild("g-mute", [
    auditEntry({
      id: "E-TIMEOUT",
      type: 24,
      targetId: "U1",
      reason: "spam",
      changes: [{ key: "communication_disabled_until", old: null, new: "2030-01-01T00:00:00.000Z" }],
    }),
  ]);
  reset(config);

  const guildMemberUpdate = require("../../src/events/guildMemberUpdate");
  const oldMember = makeMember(guild, "U1");
  const newMember = makeMember(guild, "U1", { communicationDisabledUntilTimestamp: Date.now() + 10 * 60 * 1000 });

  await guildMemberUpdate.execute(oldMember, newMember);
  await new Promise((resolve) => setTimeout(resolve, 1200));

  const moderation = guild.__sent.filter((item) => item.channelId === "CH_MOD");
  assert.equal(moderation.length, 1, `un seul log de modération, obtenu ${moderation.length}`);
  assert.match(moderation[0].embed.title, /timeout|muET/i);
  assert.ok(moderation[0].embed.fields.some((field) => field.value === "spam"));
});

test("PHASE1: /pseudo produit exactement UN log, et jamais le log technique de la commande", async () => {
  const config = makeConfig();
  const guild = makeGuild("g-nick", []);
  reset(config);

  const guildMemberUpdate = require("../../src/events/guildMemberUpdate");
  const oldMember = makeMember(guild, "U1", { nickname: "alice" });
  const newMember = makeMember(guild, "U1", { nickname: "Alice" });

  await guildMemberUpdate.execute(oldMember, newMember);
  await new Promise((resolve) => setTimeout(resolve, 1200));

  assert.equal(guild.__sent.length, 1, `un seul log, obtenu ${guild.__sent.length}`);
  const titles = guild.__sent.map((item) => item.embed.title);
  assert.equal(titles.some((title) => title === "pseudo" || title === "Log"), false, "aucun log technique de la commande");
  const fields = guild.__sent[0].embed.fields;
  assert.ok(fields.some((field) => field.value === "alice"), "ancien pseudo présent");
  assert.ok(fields.some((field) => field.value === "Alice"), "nouveau pseudo présent");
});

test("PHASE1: pseudo puis timeout du même membre — chaque log garde son propre auteur", async () => {
  const config = makeConfig();
  const guild = makeGuild("g-nick-then-mute", [
    auditEntry({
      id: "E-TIMEOUT",
      type: 24,
      targetId: "U1",
      executorId: "M1",
      executorTag: "Modo",
      reason: "spam",
      changes: [{ key: "communication_disabled_until", old: null, new: "2030-01-01T00:00:00.000Z" }],
    }),
    auditEntry({
      id: "E-NICK",
      type: 24,
      targetId: "U1",
      executorId: "M9",
      executorTag: "Renommeur",
      reason: "pseudo non conforme",
      changes: [{ key: "nick", old: "alice", new: "Alice" }],
    }),
  ]);
  reset(config);

  const guildMemberUpdate = require("../../src/events/guildMemberUpdate");
  const oldMember = makeMember(guild, "U1", { nickname: "alice" });
  const newMember = makeMember(guild, "U1", {
    nickname: "Alice",
    communicationDisabledUntilTimestamp: Date.now() + 10 * 60 * 1000,
  });

  await guildMemberUpdate.execute(oldMember, newMember);
  await new Promise((resolve) => setTimeout(resolve, 1200));

  const moderation = guild.__sent.filter((item) => item.channelId === "CH_MOD");
  assert.equal(moderation.length, 2, "un log de pseudo + un log de timeout");

  const timeoutLog = moderation.find((item) => /timeout/i.test(item.embed.title));
  assert.ok(timeoutLog, "le log de timeout existe");
  const who = timeoutLog.embed.fields.find((field) => /Modérateur/.test(field.name));
  assert.ok(who.value.includes("Modo"), `l'auteur du timeout, pas celui du renommage (obtenu : ${who.value})`);
});

test("PHASE1: un ajout de rôle produit exactement UN log pour le vrai rôle", async () => {
  const config = makeConfig();
  const guild = makeGuild("g-role-add", [
    auditEntry({
      id: "E-ROLE",
      type: 25,
      targetId: "U1",
      changes: [{ key: "$add", new: [{ id: "R1", name: "Membre" }] }],
    }),
  ]);
  reset(config);

  const guildMemberUpdate = require("../../src/events/guildMemberUpdate");
  const oldMember = makeMember(guild, "U1");
  const newMember = makeMember(guild, "U1", {
    roles: { cache: new Map([["@everyone", { id: "@everyone" }], ["R1", { id: "R1", name: "Membre" }]]) },
  });

  await guildMemberUpdate.execute(oldMember, newMember);
  await new Promise((resolve) => setTimeout(resolve, 1200));

  const roleLogs = guild.__sent.filter((item) => item.channelId === "CH_ROLE");
  assert.equal(roleLogs.length, 1, `un seul log de rôle, obtenu ${roleLogs.length}`);
  assert.ok(roleLogs[0].embed.fields.some((field) => field.value.includes("Membre")), "le vrai rôle est nommé");
});

test("PHASE1: deux membres avec AutoRole simultanément → un log chacun", async () => {
  const config = makeConfig();
  const guild = makeGuild("g-autorole", [
    auditEntry({ id: "E-R1", type: 25, targetId: "U1", changes: [{ key: "$add", new: [{ id: "R1", name: "Membre" }] }] }),
    auditEntry({ id: "E-R2", type: 25, targetId: "U2", changes: [{ key: "$add", new: [{ id: "R1", name: "Membre" }] }] }),
  ]);
  reset(config);

  const guildMemberUpdate = require("../../src/events/guildMemberUpdate");
  const withRole = (id) => makeMember(guild, id, {
    roles: { cache: new Map([["@everyone", { id: "@everyone" }], ["R1", { id: "R1", name: "Membre" }]]) },
  });

  await Promise.all([
    guildMemberUpdate.execute(makeMember(guild, "U1"), withRole("U1")),
    guildMemberUpdate.execute(makeMember(guild, "U2"), withRole("U2")),
  ]);
  await new Promise((resolve) => setTimeout(resolve, 1200));

  const roleLogs = guild.__sent.filter((item) => item.channelId === "CH_ROLE");
  assert.equal(roleLogs.length, 2, `deux logs de rôle attendus, obtenu ${roleLogs.length}`);
});

test("PHASE1: un timeout AutoMod produit UN log métier, pas deux", async () => {
  const config = makeConfig();
  const guild = makeGuild("g-automod", [
    auditEntry({
      id: "E-AUTO-TIMEOUT",
      type: 24,
      targetId: "U1",
      executorId: "BOT",
      executorTag: "Civrat",
      reason: "AutoMod: insultes",
      changes: [{ key: "communication_disabled_until", old: null, new: "2030-01-01T00:00:00.000Z" }],
    }),
  ]);
  reset(config);

  // 1. AutoMod applique la sanction et journalise.
  const { markSelfAction } = require("../../src/utils/selfActionRegistry");
  const { getLogsRuntime } = require("../../src/modules/logs/runtime/getLogsRuntime");
  markSelfAction("timeout", guild.id, "U1");
  await getLogsRuntime().handleModerationEvent({
    guild,
    config,
    action: "automod",
    targetId: "U1",
    target: "<@U1> `user_U1`",
    reason: "AutoMod: insultes",
    rule: "INSULTES",
    rules: ["INSULTES"],
    duration: "10 min",
  });
  assert.equal(guild.__sent.length, 1, "le log AutoMod est émis");

  // 2. L'événement Discord découlant du timeout ne doit pas rejouer la sanction.
  const guildMemberUpdate = require("../../src/events/guildMemberUpdate");
  await guildMemberUpdate.execute(
    makeMember(guild, "U1"),
    makeMember(guild, "U1", { communicationDisabledUntilTimestamp: Date.now() + 10 * 60 * 1000 }),
  );
  await new Promise((resolve) => setTimeout(resolve, 1200));

  assert.equal(guild.__sent.length, 1, `un seul log métier pour une seule sanction, obtenu ${guild.__sent.length}`);
});

// ─────────────────────────────────────────────────────────────
// Suppression en masse
// ─────────────────────────────────────────────────────────────

test("PHASE1: /supprimer produit exactement UN log, porté par messageDeleteBulk", async () => {
  const config = makeConfig();
  const guild = makeGuild("g-purge", []);
  reset(config);

  const messages = {
    size: 3,
    first: () => ({ guild, channel: { id: "C1", name: "général" }, author: { id: "A", tag: "Alice" }, content: "spam" }),
    map: (fn) => [
      { author: { id: "A", tag: "Alice" }, content: "spam 1" },
      { author: { id: "B", tag: "Bob" }, content: "spam 2" },
    ].map(fn),
  };

  const messageDeleteBulk = require("../../src/events/messageDeleteBulk");
  await messageDeleteBulk.execute(messages);

  assert.equal(guild.__sent.length, 1, `un seul log, obtenu ${guild.__sent.length}`);
  assert.equal(guild.__sent[0].channelId, "CH_MSG", "dans le salon « messages »");
  assert.notEqual(guild.__sent[0].embed.title, "Log", "le titre doit être traduit, pas le libellé de secours");
  const fields = guild.__sent[0].embed.fields;
  assert.ok(fields.some((field) => field.value === "3"), "le nombre de messages est rendu");
});
