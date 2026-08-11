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
  await inviteRepo.addInvite("u1", "g");
  await inviteRepo.addInvite("u1", "g");
  await inviteRepo.addInvite("u2", "g");
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
