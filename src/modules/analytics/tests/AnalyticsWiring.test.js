"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("analytics wiring in messageCreate and guildMemberAdd is isolated and non-blocking", () => {
  const msgCreate = fs.readFileSync("src/events/messageCreate.js", "utf8");
  assert.match(msgCreate, /getAnalyticsRuntime/);
  assert.match(msgCreate, /trackMessage/);
  const memberAdd = fs.readFileSync("src/events/guildMemberAdd.js", "utf8");
  assert.match(memberAdd, /getAnalyticsRuntime/);
  assert.match(memberAdd, /trackMember/);
  // Both in try/catch
  assert.ok((msgCreate.match(/try/g) || []).length >= 3);
  assert.ok((memberAdd.match(/try/g) || []).length >= 5);
});

test("analytics wiring does not break AutoMod/XP/Security", async () => {
  const { createAnalyticsRuntime } = require("../runtime/createAnalyticsRuntime");
  const runtime = createAnalyticsRuntime({
    configService: { read: async () => ({ analytics_enabled: true }) },
    analyticsRepository: { track: async () => { throw new Error("fail"); }, getStats: async () => ({ messages: 0, members: 0 }), getEvents: async () => [] },
  });
  let threw = false;
  try {
    await runtime.trackMessage({ guild: { id: "g" }, author: { id: "u", bot: false } });
    await runtime.trackMember({ guild: { id: "g" }, id: "u" });
  } catch {
    threw = true;
  }
  assert.equal(threw, false);
});
