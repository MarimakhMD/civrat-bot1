"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createAutoModRuntime } = require("../runtime/createAutoModRuntime");

function configServiceFor(config) {
  return { read: async () => config };
}

function linkMessage(content) {
  return { guild: { id: "g" }, author: { id: "u" }, content, mentions: { size: 0 } };
}

test("disabled guild is ignored", async () => {
  const runtime = createAutoModRuntime({ configService: configServiceFor({ automod_enabled: false }) });
  const result = await runtime.handleMessage(linkMessage("https://x"));
  assert.equal(result.matched, false);
  assert.equal(result.code, "AUTOMOD_DISABLED");
});

test("bot messages are ignored", async () => {
  const runtime = createAutoModRuntime({ configService: configServiceFor({ automod_enabled: true }) });
  const result = await runtime.handleMessage({ guild: { id: "g" }, author: { id: "u", bot: true }, content: "https://x", mentions: { size: 0 } });
  assert.equal(result.code, "AUTOMOD_IGNORED");
});

test("message without guild is ignored", async () => {
  const runtime = createAutoModRuntime({ configService: configServiceFor({ automod_enabled: true }) });
  const result = await runtime.handleMessage({ author: { id: "u" }, content: "https://x", mentions: { size: 0 } });
  assert.equal(result.code, "AUTOMOD_IGNORED");
});

test("link rule deletes the message and reports the violation", async () => {
  const config = { automod_enabled: true, automod_anti_links: true, automod_delete_message: true, automod_punishment: "none" };
  const deleted = [];
  const enforcer = {
    deleteMessage: async (message) => { deleted.push(message); return true; },
    timeoutUser: async () => ({ ok: true }),
    warnUser: async () => ({ ok: true }),
  };
  const runtime = createAutoModRuntime({ configService: configServiceFor(config), enforcerFactory: () => enforcer });
  const result = await runtime.handleMessage(linkMessage("check https://example.com"));
  assert.equal(result.matched, true);
  assert.equal(result.code, "AUTOMOD_LINK");
  assert.equal(deleted.length, 1);
  assert.equal(result.actions.deleted, true);
  assert.equal(result.actions.punishment, null);
});

test("clean message is not matched", async () => {
  const config = { automod_enabled: true, automod_anti_links: true, automod_bad_words: ["bad"] };
  const runtime = createAutoModRuntime({ configService: configServiceFor(config) });
  const result = await runtime.handleMessage(linkMessage("hello world"));
  assert.equal(result.code, "AUTOMOD_NO_MATCH");
});

test("bad word triggers a warn punishment", async () => {
  const config = { automod_enabled: true, automod_bad_words: ["bad"], automod_punishment: "warn", automod_delete_message: false };
  let warned = null;
  const enforcer = {
    deleteMessage: async () => false,
    timeoutUser: async () => ({ ok: true }),
    warnUser: async (payload) => { warned = payload; return { ok: true }; },
  };
  const runtime = createAutoModRuntime({ configService: configServiceFor(config), enforcerFactory: () => enforcer });
  const result = await runtime.handleMessage(linkMessage("you are bad"));
  assert.equal(result.code, "AUTOMOD_BAD_WORD");
  assert.ok(warned);
  assert.equal(warned.targetId, "u");
  assert.equal(result.actions.punishment.ok, true);
});

test("caps rule triggers a timeout punishment", async () => {
  const config = { automod_enabled: true, automod_anti_caps: true, automod_caps_threshold: 70, automod_punishment: "timeout", automod_timeout_minutes: 5, automod_delete_message: false };
  let timedOut = null;
  const enforcer = {
    deleteMessage: async () => false,
    timeoutUser: async (payload) => { timedOut = payload; return { ok: true }; },
    warnUser: async () => ({ ok: true }),
  };
  const runtime = createAutoModRuntime({ configService: configServiceFor(config), enforcerFactory: () => enforcer });
  const result = await runtime.handleMessage({ guild: { id: "g" }, author: { id: "u" }, content: "AAAAAAAAAAAAAAAA", mentions: { size: 0 } });
  assert.equal(result.code, "AUTOMOD_CAPS");
  assert.ok(timedOut);
  assert.equal(timedOut.targetId, "u");
  assert.equal(timedOut.durationMinutes, 5);
});

test("logs hook is invoked on violation", async () => {
  const config = { automod_enabled: true, automod_anti_links: true };
  let logged = null;
  const enforcer = { deleteMessage: async () => true, timeoutUser: async () => ({ ok: true }), warnUser: async () => ({ ok: true }) };
  const runtime = createAutoModRuntime({
    configService: configServiceFor(config),
    enforcerFactory: () => enforcer,
    logsRuntimeFactory: () => ({ disabled: false, handleModerationEvent: async (event) => { logged = event; } }),
  });
  await runtime.handleMessage(linkMessage("https://x"));
  assert.ok(logged);
  assert.equal(logged.action, "automod");
  assert.equal(logged.targetId, "u");
});
