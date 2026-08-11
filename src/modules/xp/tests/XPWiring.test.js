"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("messageCreate wiring calls both AutoMod and XP and remains non-blocking", () => {
  const source = fs.readFileSync("src/events/messageCreate.js", "utf8");
  assert.match(source, /getAutoModRuntime/);
  assert.match(source, /getXPRuntime/);
  assert.match(source, /handleMessage/);
  assert.match(source, /message\.author.*bot/);
  assert.match(source, /!message\.guild/);
  // Both in try/catch - at least one import and one call each
  const autoModCount = (source.match(/getAutoModRuntime/g) || []).length;
  const xpCount = (source.match(/getXPRuntime/g) || []).length;
  assert.ok(autoModCount >= 2, `expected at least 2 getAutoModRuntime, got ${autoModCount}`);
  assert.ok(xpCount >= 1, `expected at least 1 getXPRuntime, got ${xpCount}`);
  assert.doesNotMatch(source, /securityService/);
});

test("messageCreate does not break AutoMod or Security", async () => {
  // Mock both runtimes to ensure XP does not break AutoMod
  const autoModMod = require("../../automod/runtime/getAutoModRuntime");
  const xpMod = require("../runtime/getXPRuntime");
  const origAuto = autoModMod.getAutoModRuntime;
  const origXp = xpMod.getXPRuntime;
  let autoCalled = false, xpCalled = false;
  autoModMod.getAutoModRuntime = () => ({ handleMessage: async () => { autoCalled = true; } });
  xpMod.getXPRuntime = () => ({ handleMessage: async () => { xpCalled = true; } });
  const event = require("../../../events/messageCreate");
  // Need to clear require cache for event to pick up mocks
  delete require.cache[require.resolve("../../../events/messageCreate")];
  const freshEvent = require("../../../events/messageCreate");
  await freshEvent.execute({ guild: { id: "g" }, author: { id: "u", bot: false }, content: "hi", mentions: { size: 0 }, channel: { id: "c1" } });
  assert.equal(autoCalled, true);
  assert.equal(xpCalled, true);
  autoModMod.getAutoModRuntime = origAuto;
  xpMod.getXPRuntime = origXp;
  delete require.cache[require.resolve("../../../events/messageCreate")];
});

test("XP persistence InMemory and Mongo mock", async () => {
  const { InMemoryXPRepository } = require("../persistence/XPRepository");
  const repo = new InMemoryXPRepository();
  await repo.upsert("g", "u", 100, 1);
  const found = await repo.findOne("g", "u");
  assert.equal(found.xp, 100);
  assert.equal(found.level, 1);
  // Mongo mock
  const { MongoXPRepository } = require("../persistence/MongoXPRepository");
  const mockModel = {
    findOne: () => ({ lean: async () => ({ guildId: "g", userId: "u", xp: 50, level: 0 }) }),
    findOneAndUpdate: () => ({ lean: async () => ({ guildId: "g", userId: "u", xp: 70, level: 0 }) }),
  };
  const mongoRepo = new MongoXPRepository({ model: mockModel });
  const found2 = await mongoRepo.findOne("g", "u");
  assert.equal(found2.xp, 50);
  const upserted = await mongoRepo.upsert("g", "u", 70, 0);
  assert.equal(upserted.xp, 70);
});
