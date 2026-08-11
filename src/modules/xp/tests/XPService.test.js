"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { XPService } = require("../services/XPService");
const { LevelService } = require("../services/LevelService");
const { InMemoryXPRepository } = require("../persistence/XPRepository");

test("level calculations", () => {
  const svc = new LevelService();
  assert.equal(svc.levelForXp(0), 0);
  assert.equal(svc.levelForXp(99), 0);
  assert.equal(svc.levelForXp(100), 1);
  assert.equal(svc.levelForXp(199), 1);
  assert.equal(svc.levelForXp(200), 2);
  assert.equal(svc.xpForLevel(0), 0);
  assert.equal(svc.xpForLevel(1), 100);
  assert.equal(svc.progress(150).level, 1);
  assert.equal(svc.progress(150).percent, 50);
});

test("XP ignored for bot, no guild, disabled", async () => {
  const repo = new InMemoryXPRepository();
  const svc = new XPService({ repository: repo, random: () => 20 });
  assert.equal((await svc.handleMessage({ guildId: null, userId: "u", isBot: false, config: { xp_enabled: true } })).code, "XP_IGNORED");
  assert.equal((await svc.handleMessage({ guildId: "g", userId: null, isBot: false, config: { xp_enabled: true } })).code, "XP_IGNORED");
  assert.equal((await svc.handleMessage({ guildId: "g", userId: "u", isBot: true, config: { xp_enabled: true } })).code, "XP_IGNORED");
  assert.equal((await svc.handleMessage({ guildId: "g", userId: "u", isBot: false, config: { xp_enabled: false } })).code, "XP_DISABLED");
  assert.equal((await svc.handleMessage({ guildId: "g", userId: "u", isBot: false, config: null })).code, "XP_DISABLED");
});

test("XP gain and cooldown", async () => {
  const repo = new InMemoryXPRepository();
  let now = 0;
  const svc = new XPService({ repository: repo, clock: () => now, random: () => 20 });
  const config = { xp_enabled: true, xp_rate: 1 };
  const first = await svc.handleMessage({ guildId: "g", userId: "u", isBot: false, config });
  assert.equal(first.code, "XP_GAINED");
  assert.equal(first.xpGain, 20);
  assert.equal(first.xp, 20);
  // Cooldown 60s
  now += 1000;
  const second = await svc.handleMessage({ guildId: "g", userId: "u", isBot: false, config });
  assert.equal(second.code, "XP_COOLDOWN");
  now += 60000;
  const third = await svc.handleMessage({ guildId: "g", userId: "u", isBot: false, config });
  assert.equal(third.code, "XP_GAINED");
  assert.equal(third.xp, 40);
});

test("XP level up", async () => {
  const repo = new InMemoryXPRepository();
  const svc = new XPService({ repository: repo, random: () => 20 });
  const config = { xp_enabled: true, xp_rate: 1 };
  await repo.upsert("g", "u", 90, 0);
  const res = await svc.handleMessage({ guildId: "g", userId: "u", isBot: false, config });
  assert.equal(res.code, "XP_LEVELED_UP");
  assert.equal(res.level, 1);
  assert.equal(res.leveledUp, true);
  assert.equal(res.xp, 110);
});

test("XP rate multiplier", async () => {
  const repo = new InMemoryXPRepository();
  const svc = new XPService({ repository: repo, random: () => 20 });
  const config = { xp_enabled: true, xp_rate: 2 };
  const res = await svc.handleMessage({ guildId: "g", userId: "u", isBot: false, config });
  assert.equal(res.xpGain, 40);
});

test("XP repository integration", async () => {
  const repo = new InMemoryXPRepository();
  const svc = new XPService({ repository: repo, random: () => 15 });
  const config = { xp_enabled: true };
  await svc.handleMessage({ guildId: "g", userId: "u1", isBot: false, config });
  await svc.handleMessage({ guildId: "g", userId: "u2", isBot: false, config });
  const u1 = await repo.findOne("g", "u1");
  const u2 = await repo.findOne("g", "u2");
  assert.equal(u1.xp, 15);
  assert.equal(u2.xp, 15);
  assert.notEqual(u1.userId, u2.userId);
});

test("XP requires repository", () => {
  assert.throws(() => new XPService({}), /repository/);
});
