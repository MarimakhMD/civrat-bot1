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

// A2 (DCA4) — la restriction de l'XP à un salon est supprimée : la colonne
// xp_channel_id n'existe pas en base. Un message publié dans N'IMPORTE QUEL
// salon donne donc de l'XP, et le code XP_WRONG_CHANNEL a disparu.
test("A2 — every channel grants XP and XP_WRONG_CHANNEL no longer exists", async () => {
  const repo = new InMemoryXPRepository();
  const runtime = createXPRuntime({
    // Configuration historique contenant encore la clé fantôme.
    configService: { read: async () => ({ xp_enabled: true, xp_per_message: 10, xp_cooldown: 0, xp_channel_id: "c1" }) },
    repository: repo,
  });

  const other = await runtime.handleMessage(memberMessage("g", "u", "c2"));
  assert.equal(other.code, "XP_GAINED", "un salon différent ne doit plus bloquer l'XP");
  assert.equal(other.xpGain, 10);

  const same = await runtime.handleMessage(memberMessage("g", "u2", "c1"));
  assert.equal(same.code, "XP_GAINED");
  assert.notEqual(other.code, "XP_WRONG_CHANNEL");
});

test("XP gain and level up with logs", async () => {
  const repo = new InMemoryXPRepository();
  let logged = null;
  const runtime = createXPRuntime({
    configService: { read: async () => ({ xp_enabled: true, xp_per_message: 20, xp_cooldown: 0 }) },
    repository: repo,
    logsRuntimeFactory: () => ({ disabled: false, handleModerationEvent: async (e) => { logged = e; } }),
  });
  await repo.upsert("g", "u", 90, 0);
  const res = await runtime.handleMessage(memberMessage("g", "u"));
  assert.equal(res.code, "XP_LEVELED_UP");
  assert.equal(res.level, 1);
  assert.equal(res.xpGain, 20);
  assert.ok(logged);
  assert.equal(logged.action, "xp_level_up");
  assert.equal(logged.rule, "XP_LEVEL_UP");
});

test("XP cooldown prevents gain", async () => {
  let now = 0;
  const repo = new InMemoryXPRepository();
  const runtime = createXPRuntime({
    configService: { read: async () => ({ xp_enabled: true, xp_per_message: 20, xp_cooldown: 60 }) },
    repository: repo,
    clock: () => now,
  });
  const first = await runtime.handleMessage(memberMessage("g", "u"));
  assert.equal(first.code, "XP_GAINED");
  now += 1000;
  const second = await runtime.handleMessage(memberMessage("g", "u"));
  assert.equal(second.code, "XP_COOLDOWN");
  now += 59000;
  const third = await runtime.handleMessage(memberMessage("g", "u"));
  assert.equal(third.code, "XP_GAINED");
  assert.equal(third.xp, 40);
});

test("A2 — a zero cooldown lets every message through at runtime level", async () => {
  const now = 0;
  const repo = new InMemoryXPRepository();
  const runtime = createXPRuntime({
    configService: { read: async () => ({ xp_enabled: true, xp_per_message: 5, xp_cooldown: 0 }) },
    repository: repo,
    clock: () => now,
  });
  for (let i = 0; i < 3; i += 1) {
    assert.equal((await runtime.handleMessage(memberMessage("g", "u"))).code, "XP_GAINED");
  }
});

test("XP ignores bot and missing guild", async () => {
  const runtime = createXPRuntime({ configService: { read: async () => ({ xp_enabled: true }) } });
  assert.equal((await runtime.handleMessage({ guild: null, author: { id: "u", bot: false } })).code, "XP_IGNORED");
  assert.equal((await runtime.handleMessage({ guild: { id: "g" }, author: { id: "u", bot: true } })).code, "XP_IGNORED");
});

test("XP runtime does not throw when logs fail", async () => {
  const repo = new InMemoryXPRepository();
  const runtime = createXPRuntime({
    configService: { read: async () => ({ xp_enabled: true, xp_per_message: 20, xp_cooldown: 0 }) },
    repository: repo,
    logsRuntimeFactory: () => ({ disabled: false, handleModerationEvent: async () => { throw new Error("log fail"); } }),
  });
  await repo.upsert("g", "u", 90, 0);
  const res = await runtime.handleMessage(memberMessage("g", "u"));
  assert.equal(res.code, "XP_LEVELED_UP");
});

test("A2 — a corrupted configuration never breaks message processing", async () => {
  const repo = new InMemoryXPRepository();
  const runtime = createXPRuntime({
    configService: { read: async () => ({ xp_enabled: true, xp_per_message: null, xp_cooldown: "absurde" }) },
    repository: repo,
  });
  const res = await runtime.handleMessage(memberMessage("g", "u"));
  assert.equal(res.code, "XP_GAINED");
  assert.equal(res.xpGain, 15);
});
