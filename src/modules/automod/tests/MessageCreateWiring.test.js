"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("messageCreate wiring uses getAutoModRuntime and remains non-blocking", () => {
  const source = fs.readFileSync("src/events/messageCreate.js", "utf8");
  assert.match(source, /getAutoModRuntime/);
  assert.match(source, /handleMessage/);
  assert.match(source, /message\.author.*bot/);
  assert.match(source, /!message\.guild/);
  assert.match(source, /try/);
  assert.doesNotMatch(source, /securityService/);
  assert.doesNotMatch(source, /require\(".*services\/guildConfig"\)/);
});

test("getAutoModRuntime no longer has hard dependency on legacy guildConfig", () => {
  const source = fs.readFileSync("src/modules/automod/runtime/getAutoModRuntime.js", "utf8");
  assert.match(source, /try/);
  assert.match(source, /catch/);
  assert.match(source, /Fallback/);
  assert.doesNotMatch(source, /^const legacy = require\(".*services\/guildConfig"\)/m);
});

test("messageCreate ignores bots and messages hors guild, non-blocking", async () => {
  const { getAutoModRuntime } = require("../runtime/getAutoModRuntime");
  // Reset singleton to ensure fresh runtime with fallback
  if (typeof getAutoModRuntime._resetForTests === "function") {
    const mod = require("../runtime/getAutoModRuntime");
    if (mod._resetForTests) mod._resetForTests();
  }
  const event = require("../../../events/messageCreate");
  // Should not throw for null, no guild, bot
  let threw = false;
  try {
    await event.execute(null);
    await event.execute({ guild: null, author: { bot: false }, content: "hi" });
    await event.execute({ guild: { id: "g" }, author: { bot: true }, content: "hi" });
    await event.execute({ guild: { id: "g" }, author: { id: "u", bot: false }, content: "hello", mentions: { size: 0 } });
  } catch {
    threw = true;
  }
  assert.equal(threw, false);
});

test("getAutoModRuntime handles missing legacy guildConfig via fallback", async () => {
  const mod = require("../runtime/getAutoModRuntime");
  if (mod._resetForTests) mod._resetForTests();
  const runtime = mod.getAutoModRuntime();
  assert.ok(runtime);
  assert.equal(typeof runtime.handleMessage, "function");
  // With fallback config (empty → automod_enabled false → DISABLED), should not throw
  const result = await runtime.handleMessage({ guild: { id: "g" }, author: { id: "u", bot: false }, content: "https://x", mentions: { size: 0 } });
  assert.equal(result.code, "AUTOMOD_DISABLED");
});
