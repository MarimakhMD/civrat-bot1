"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { AnalyticsService } = require("../services/AnalyticsService");
const { InMemoryAnalyticsRepository } = require("../persistence/InMemoryAnalyticsRepository");
const { InMemoryXPRepository } = require("../../xp/persistence/XPRepository");
const { InMemoryInviteStatsRepository } = require("../../invites/persistence/InviteStatsRepository");

function configService(enabled = true) {
  return { read: async () => ({ analytics_enabled: enabled }), update: async () => ({}) };
}

test("trackMessage and trackMember respect enabled flag", async () => {
  const repo = new InMemoryAnalyticsRepository();
  const svc = new AnalyticsService({ configService: configService(true), analyticsRepository: repo });
  const r1 = await svc.trackMessage({ guildId: "g", userId: "u1" });
  assert.equal(r1.tracked, true);
  const r2 = await svc.trackMember({ guildId: "g", userId: "u2" });
  assert.equal(r2.tracked, true);
  const disabled = new AnalyticsService({ configService: configService(false), analyticsRepository: repo });
  assert.equal((await disabled.trackMessage({ guildId: "g", userId: "u1" })).code, "ANALYTICS_DISABLED");
});

test("getStats aggregates messages and members", async () => {
  const repo = new InMemoryAnalyticsRepository();
  const svc = new AnalyticsService({ configService: configService(true), analyticsRepository: repo });
  await svc.trackMessage({ guildId: "g", userId: "u1" });
  await svc.trackMessage({ guildId: "g", userId: "u1" });
  await svc.trackMember({ guildId: "g", userId: "u2" });
  await svc.trackMember({ guildId: "g", userId: "u2" }); // duplicate member should count once for members
  const stats = await svc.getStats("g");
  assert.equal(stats.messages, 2);
  assert.equal(stats.members, 1);
  assert.equal(stats.total, 4);
});

test("getTopXP aggregates from XP repository without duplicating", async () => {
  const xpRepo = new InMemoryXPRepository();
  await xpRepo.upsert("g", "u1", 100, 1);
  await xpRepo.upsert("g", "u2", 200, 2);
  await xpRepo.upsert("g", "u3", 50, 0);
  const svc = new AnalyticsService({ configService: configService(true), analyticsRepository: new InMemoryAnalyticsRepository(), xpRepository: xpRepo });
  const top = await svc.getTopXP("g", 2);
  assert.equal(top.length, 2);
  assert.equal(top[0].userId, "u2");
  assert.equal(top[0].xp, 200);
  assert.equal(top[1].userId, "u1");
});

test("getTopInvites aggregates from Invite repository", async () => {
  const inviteRepo = new InMemoryInviteStatsRepository();
  // B2 — chaque attribution nomme le membre invité (PK guild_id + invited_id).
  await inviteRepo.addInvite("u1", "g", "invited-1");
  await inviteRepo.addInvite("u1", "g", "invited-2");
  await inviteRepo.addInvite("u2", "g", "invited-3");
  const svc = new AnalyticsService({ configService: configService(true), analyticsRepository: new InMemoryAnalyticsRepository(), inviteRepository: inviteRepo });
  const top = await svc.getTopInvites("g", 2);
  assert.equal(top.length, 2);
  assert.equal(top[0].userId, "u1");
  assert.equal(top[0].current, 2);
  assert.equal(top[1].userId, "u2");
});

test("getTopXP/Invites return empty when no repository", async () => {
  const svc = new AnalyticsService({ configService: configService(true), analyticsRepository: new InMemoryAnalyticsRepository() });
  assert.deepEqual(await svc.getTopXP("g"), []);
  assert.deepEqual(await svc.getTopInvites("g"), []);
});

test("getStats respects disabled", async () => {
  const svc = new AnalyticsService({ configService: configService(false), analyticsRepository: new InMemoryAnalyticsRepository() });
  const stats = await svc.getStats("g");
  assert.equal(stats.enabled, false);
  assert.equal(stats.messages, 0);
});

// --- P10 — propagation du drapeau de troncature à travers le service --------
// Le dépôt renvoie membersTruncated ; AnalyticsService fait { enabled, ...stats }
// et doit donc le propager tel quel jusqu'à la vue. Aucun chiffre plafonné ne
// peut être présenté comme exact.

test("P10 — getStats propagates membersTruncated from the repository", async () => {
  const truncatedRepo = { getStats: async () => ({ messages: 48213, members: 5000, total: 53213, membersTruncated: true }) };
  const svc = new AnalyticsService({ configService: configService(true), analyticsRepository: truncatedRepo });
  const stats = await svc.getStats("g");
  assert.equal(stats.enabled, true);
  assert.equal(stats.messages, 48213);
  assert.equal(stats.members, 5000);
  assert.equal(stats.total, 53213);
  assert.equal(stats.membersTruncated, true, "le drapeau doit traverser le service");
});

test("P10 — getStats keeps membersTruncated false when the repository says so", async () => {
  const exactRepo = { getStats: async () => ({ messages: 12, members: 3, total: 15, membersTruncated: false }) };
  const svc = new AnalyticsService({ configService: configService(true), analyticsRepository: exactRepo });
  const stats = await svc.getStats("g");
  assert.equal(stats.membersTruncated, false);
});

test("P10 — disabled analytics returns no truncation flag (falsy => no '+' in the UI)", async () => {
  const repo = new InMemoryAnalyticsRepository();
  const svc = new AnalyticsService({ configService: configService(false), analyticsRepository: repo });
  const stats = await svc.getStats("g");
  assert.equal(stats.enabled, false);
  assert.equal(stats.members, 0);
  assert.ok(!stats.membersTruncated, "absent ou faux : la vue n'affichera pas '+'");
});

test("P10 — InMemory parity: same keys as the Supabase repository, flags always false", async () => {
  const repo = new InMemoryAnalyticsRepository();
  await repo.track("g", { type: "message", userId: "u1" });
  await repo.track("g", { type: "member", userId: "u1" });
  const stats = await repo.getStats("g");
  assert.deepEqual(Object.keys(stats).sort(), ["members", "membersTruncated", "messages", "total"]);
  assert.equal(stats.membersTruncated, false);
  const global = await repo.getGlobalStats();
  assert.deepEqual(Object.keys(global).sort(), ["members", "messages", "servers", "truncated"]);
  assert.equal(global.truncated, false);
});
