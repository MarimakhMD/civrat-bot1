"use strict";

// Phase 11 — contrat getLeaderboard des repositories XP (consommé par
// Analytics /analytics et /analytics_xp sur la MÊME instance que l'écriture).

const test = require("node:test");
const assert = require("node:assert/strict");
const { XPRepository, InMemoryXPRepository } = require("../persistence/XPRepository");
const { MongoXPRepository } = require("../persistence/MongoXPRepository");

test("XPRepository contract declares getLeaderboard", async () => {
  const repo = new XPRepository();
  await assert.rejects(() => repo.getLeaderboard("g"), /getLeaderboard must be implemented/);
});

test("InMemory getLeaderboard sorts by xp desc, isolates guilds and applies the limit", async () => {
  const repo = new InMemoryXPRepository();
  await repo.upsert("g", "low", 50, 0);
  await repo.upsert("g", "top", 300, 5);
  await repo.upsert("g", "mid", 100, 1);
  await repo.upsert("other", "alien", 9999, 9);
  const top = await repo.getLeaderboard("g", 2);
  assert.equal(top.length, 2);
  assert.deepEqual(top[0], { userId: "top", xp: 300, level: 5 });
  assert.deepEqual(top[1], { userId: "mid", xp: 100, level: 1 });
  const full = await repo.getLeaderboard("g", 10);
  assert.equal(full.length, 3);
  assert.ok(full.every((e) => e.userId !== "alien"), "leaderboard must not leak another guild");
});

test("InMemory getLeaderboard breaks xp ties by level desc", async () => {
  const repo = new InMemoryXPRepository();
  await repo.upsert("g", "a", 100, 1);
  await repo.upsert("g", "b", 100, 7);
  const top = await repo.getLeaderboard("g", 10);
  assert.equal(top[0].userId, "b");
});

test("Mongo getLeaderboard queries the model with xp/level sort and limit", async () => {
  const calls = [];
  const mockModel = {
    find: (query) => {
      calls.push(query);
      return {
        sort: (spec) => { calls.push(spec); return {
          limit: (n) => { calls.push(n); return {
            lean: async () => [{ guildId: "g", userId: "u1", xp: 200, level: 2 }, { guildId: "g", userId: "u2", xp: 10, level: 0 }],
          }; },
        }; },
      };
    },
  };
  const repo = new MongoXPRepository({ model: mockModel });
  const top = await repo.getLeaderboard("g", 5);
  assert.deepEqual(calls, [{ guildId: "g" }, { xp: -1, level: -1 }, 5]);
  assert.deepEqual(top, [{ userId: "u1", xp: 200, level: 2 }, { userId: "u2", xp: 10, level: 0 }]);
});

test("getXPRuntime falls back to InMemory when mongoose is not connected", async () => {
  const { getXPRuntime, _resetForTests } = require("../runtime/getXPRuntime");
  _resetForTests();
  const runtime = getXPRuntime();
  assert.ok(runtime._repository instanceof InMemoryXPRepository, "offline runtime must use the InMemory repository, never a buffering Mongo model");
  _resetForTests();
});
