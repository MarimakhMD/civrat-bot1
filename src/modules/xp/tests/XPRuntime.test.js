"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createXPRuntime } = require("../runtime/createXPRuntime");
const { InMemoryXPRepository } = require("../persistence/XPRepository");

function memberMessage(guildId, userId, channelId = "c1", isBot = false) {
  return { guild: { id: guildId }, author: { id: userId, bot: isBot }, channel: { id: channelId }, content: "hello" };
}

test("XP disabled returns XP_DISABLED", async () => {
  const runtime = createXPRuntime({ configService: { read: async () => ({ xp_enabled: false }) } });
  const res = await runtime.handleMessage(memberMessage("g", "u"));
  assert.equal(res.code, "XP_DISABLED");
});

test("XP wrong channel returns XP_WRONG_CHANNEL", async () => {
  const runtime = createXPRuntime({ configService: { read: async () => ({ xp_enabled: true, xp_channel_id: "c1" }) } });
  const res = await runtime.handleMessage(memberMessage("g", "u", "c2"));
  assert.equal(res.code, "XP_WRONG_CHANNEL");
});

test("XP gain and level up with logs", async () => {
  const repo = new InMemoryXPRepository();
  let logged = null;
  const runtime = createXPRuntime({
    configService: { read: async () => ({ xp_enabled: true, xp_rate: 1 }) },
    repository: repo,
    random: () => 20,
    logsRuntimeFactory: () => ({ disabled: false, handleModerationEvent: async (e) => { logged = e; } }),
  });
  await repo.upsert("g", "u", 90, 0);
  const res = await runtime.handleMessage(memberMessage("g", "u"));
  assert.equal(res.code, "XP_LEVELED_UP");
  assert.equal(res.level, 1);
  assert.ok(logged);
  assert.equal(logged.action, "xp_level_up");
  assert.equal(logged.rule, "XP_LEVEL_UP");
});

test("XP cooldown prevents gain", async () => {
  let now = 0;
  const repo = new InMemoryXPRepository();
  const runtime = createXPRuntime({
    configService: { read: async () => ({ xp_enabled: true }) },
    repository: repo,
    clock: () => now,
    random: () => 20,
  });
  const first = await runtime.handleMessage(memberMessage("g", "u"));
  assert.equal(first.code, "XP_GAINED");
  now += 1000;
  const second = await runtime.handleMessage(memberMessage("g", "u"));
  assert.equal(second.code, "XP_COOLDOWN");
  now += 60000;
  const third = await runtime.handleMessage(memberMessage("g", "u"));
  assert.equal(third.code, "XP_GAINED");
});

test("XP ignores bot and missing guild", async () => {
  const runtime = createXPRuntime({ configService: { read: async () => ({ xp_enabled: true }) } });
  assert.equal((await runtime.handleMessage({ guild: null, author: { id: "u", bot: false } })).code, "XP_IGNORED");
  assert.equal((await runtime.handleMessage({ guild: { id: "g" }, author: { id: "u", bot: true } })).code, "XP_IGNORED");
});

test("XP runtime does not throw when logs fail", async () => {
  const repo = new InMemoryXPRepository();
  const runtime = createXPRuntime({
    configService: { read: async () => ({ xp_enabled: true }) },
    repository: repo,
    random: () => 20,
    logsRuntimeFactory: () => ({ disabled: false, handleModerationEvent: async () => { throw new Error("log fail"); } }),
  });
  await repo.upsert("g", "u", 90, 0);
  const res = await runtime.handleMessage(memberMessage("g", "u"));
  assert.equal(res.code, "XP_LEVELED_UP");
});
