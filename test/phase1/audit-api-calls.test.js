"use strict";

/**
 * PHASE 1 — appels API et concurrence.
 *
 * Trois garanties :
 *  • une action ne déclenche qu'UNE lecture d'Audit Log, même quand plusieurs
 *    usages en ont besoin (détection de kick ET décrément d'invitations) ;
 *  • aucun appel Audit Log n'est émis quand l'événement n'en a pas besoin ;
 *  • le cache partagé ne sert jamais à un appel la réponse d'un autre.
 *
 * L'optimisation ne doit jamais diminuer la fiabilité : chaque test vérifie
 * aussi que l'attribution reste correcte.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { fetchAuditLogEntries, fetchAuditLog, _clearCache } = require("../../src/utils/auditLogCache");
const { resolveAuditAction, _resetConsumed } = require("../../src/utils/auditLogActor");
const guildConfigModule = require("../../src/services/guildConfig");
const inviteService = require("../../src/services/inviteService");

const originalGetGuildConfig = guildConfigModule.getGuildConfig;
const originalRevokeInvite = inviteService.revokeInvite;

function makeGuild(guildId, entries) {
  const state = { calls: 0 };
  return {
    id: guildId,
    state,
    channels: { cache: new Map() },
    fetchAuditLogs: async ({ type, limit }) => {
      state.calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 15));
      const list = entries.filter((entry) => entry.__type === type);
      return { entries: { filter: () => list.slice(0, limit) } };
    },
  };
}

test.before(() => {
  delete require.cache[require.resolve("../../src/modules/logs/runtime/getLogsRuntime")];
});

test.after(() => {
  guildConfigModule.getGuildConfig = originalGetGuildConfig;
  inviteService.revokeInvite = originalRevokeInvite;
  _clearCache();
  _resetConsumed();
});

test("PHASE1: deux résolutions simultanées sur la même clé ne font qu'un appel API", async () => {
  _clearCache();
  _resetConsumed();
  const guild = makeGuild("g-single-flight", [
    { __type: 20, id: "E1", target: { id: "U1" }, executor: { id: "M1", tag: "Modo" }, reason: "r", createdAt: new Date() },
  ]);

  const results = await Promise.all([
    resolveAuditAction({ guild, type: 20, targetId: "U1" }),
    resolveAuditAction({ guild, type: 20, targetId: "U2" }),
  ]);

  assert.equal(guild.state.calls, 1, "une seule requête pour deux résolutions simultanées");
  assert.equal(results[0].matched, true, "la première résolution obtient bien l'entrée");
  assert.equal(results[1].matched, false, "la seconde ne se voit pas attribuer l'entrée d'un autre membre");
});

test("PHASE1: le cache partagé ne sert jamais la réponse d'un autre type d'audit", async () => {
  _clearCache();
  _resetConsumed();
  const guild = makeGuild("g-type-isolation", [
    { __type: 20, id: "E-KICK", target: { id: "U1" }, executor: { id: "M1", tag: "Modo" }, reason: "kick", createdAt: new Date() },
    { __type: 24, id: "E-UPDATE", target: { id: "U1" }, executor: { id: "M2", tag: "Autre" }, reason: "pseudo", createdAt: new Date() },
  ]);

  const kick = await resolveAuditAction({ guild, type: 20, targetId: "U1" });
  const update = await resolveAuditAction({ guild, type: 24, targetId: "U1" });

  assert.equal(kick.entry.id, "E-KICK");
  assert.equal(update.entry.id, "E-UPDATE");
  assert.equal(guild.state.calls, 2, "une requête par type d'audit, pas de mélange");
});

test("PHASE1: fetchAuditLog et fetchAuditLogEntries partagent la même lecture", async () => {
  _clearCache();
  const guild = makeGuild("g-shared-read", [
    { __type: 20, id: "E1", target: { id: "U1" }, executor: null, reason: null, createdAt: new Date() },
  ]);

  const single = await fetchAuditLog(guild, 20);
  const many = await fetchAuditLogEntries(guild, 20);

  assert.equal(guild.state.calls, 1, "la seconde lecture est servie par le cache");
  assert.equal(single.id, "E1");
  assert.equal(many.length, 1);
  assert.equal(many[0].id, "E1");
});

test("PHASE1: un départ de membre ne déclenche qu'une seule lecture d'Audit Log", async () => {
  _clearCache();
  _resetConsumed();

  let auditCalls = 0;
  let revoked = 0;
  guildConfigModule.getGuildConfig = async () => ({ logs_enabled: true, language: "fr", invitations_enabled: true });
  inviteService.revokeInvite = async () => { revoked += 1; return { revoked: true }; };
  delete require.cache[require.resolve("../../src/modules/logs/runtime/getLogsRuntime")];

  const sent = [];
  const cache = new Map([["CH", { id: "CH", isTextBased: () => true, send: async (payload) => { sent.push(payload.embeds[0].toJSON()); return { id: "S" }; } }]]);
  const guild = {
    id: "g-one-read",
    memberCount: 5,
    channels: { cache },
    fetchAuditLogs: async () => { auditCalls += 1; return { entries: { filter: () => [] } }; },
  };
  guildConfigModule.getGuildConfig = async () => ({
    logs_enabled: true,
    language: "fr",
    invitations_enabled: true,
    log_member_leave_channel_id: "CH",
  });

  const guildMemberRemove = require("../../src/events/guildMemberRemove");
  await guildMemberRemove.execute({
    id: "U1",
    guild,
    user: { id: "U1", tag: "Alice", bot: false, createdAt: new Date("2024-01-01"), displayAvatarURL: () => null },
  });
  await new Promise((resolve) => setTimeout(resolve, 1700));

  assert.equal(auditCalls, 1, `une seule lecture d'audit, obtenu ${auditCalls}`);
  assert.equal(revoked, 1, "le départ volontaire révoque bien l'invitation");
  assert.equal(sent.length, 1, "un seul log de départ");
});

test("PHASE1: un événement qui n'a pas besoin d'audit ne lit pas l'audit", async () => {
  _clearCache();
  _resetConsumed();

  let auditCalls = 0;
  const guild = {
    id: "g-no-audit",
    channels: { cache: new Map() },
    fetchAuditLogs: async () => { auditCalls += 1; return { entries: { filter: () => [] } }; },
  };
  guildConfigModule.getGuildConfig = async () => ({ logs_enabled: true, language: "fr" });

  const messageDelete = require("../../src/events/messageDelete");
  await messageDelete.execute({
    guild,
    id: "M1",
    channelId: "C1",
    channel: { id: "C1", name: "général" },
    author: { id: "A", tag: "Alice", displayAvatarURL: () => null },
    content: "bonjour",
  });

  assert.equal(auditCalls, 0, "la suppression de message ne nécessite aucun Audit Log");
});
