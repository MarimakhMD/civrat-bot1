"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createAutoModRuntime } = require("../runtime/createAutoModRuntime");
const { handleModerationEvent } = require("../../logs/events/handleModerationEvent");

function configServiceFor(config) {
  return { read: async () => config };
}

function linkMessage(content) {
  return { guild: { id: "g" }, author: { id: "u" }, content, mentions: { size: 0 } };
}

test("AutoMod logs branch via Logs Foundation with reason/rule/rules", async () => {
  const config = { automod_enabled: true, automod_anti_links: true, automod_delete_message: false, automod_punishment: "none" };
  let logged = null;
  const runtime = createAutoModRuntime({
    configService: configServiceFor(config),
    enforcerFactory: () => ({ deleteMessage: async () => true, timeoutUser: async () => ({ ok: true }), warnUser: async () => ({ ok: true }) }),
    logsRuntimeFactory: () => ({
      disabled: false,
      handleModerationEvent: async (event) => {
        logged = event;
      },
    }),
  });
  await runtime.handleMessage(linkMessage("https://x"));
  assert.ok(logged);
  assert.equal(logged.action, "automod");
  assert.equal(logged.targetId, "u");
  assert.equal(logged.reason, "AutoMod: AUTOMOD_LINK");
  assert.equal(logged.rule, "AUTOMOD_LINK");
  assert.deepEqual(logged.rules, ["AUTOMOD_LINK"]);
});

test("AutoMod logs include all matched rules in priority order", async () => {
  const config = {
    automod_enabled: true,
    automod_anti_links: true,
    automod_anti_mention_spam: true,
    automod_mention_threshold: 2,
    automod_anti_emoji_spam: true,
    automod_emoji_threshold: 2,
    automod_bad_words: ["bad"],
    automod_punishment: "warn",
  };
  let logged = null;
  const runtime = createAutoModRuntime({
    configService: configServiceFor(config),
    enforcerFactory: () => ({ deleteMessage: async () => true, timeoutUser: async () => ({ ok: true }), warnUser: async () => ({ ok: true }) }),
    logsRuntimeFactory: () => ({ disabled: false, handleModerationEvent: async (e) => { logged = e; } }),
  });
  await runtime.handleMessage({ guild: { id: "g" }, author: { id: "u" }, content: "https://x bad 😀😀😀", mentions: { size: 3 } });
  assert.ok(logged);
  assert.equal(logged.rule, "AUTOMOD_LINK");
  assert.ok(Array.isArray(logged.rules));
  assert.ok(logged.rules.includes("AUTOMOD_LINK"));
  assert.ok(logged.rules.includes("AUTOMOD_MENTION_SPAM"));
  assert.ok(logged.rules.includes("AUTOMOD_EMOJI_SPAM"));
  assert.equal(logged.reason, "AutoMod: AUTOMOD_LINK");
});

test("Logs Foundation handleModerationEvent stores reason/rule/rules in details", async () => {
  const entry = await handleModerationEvent({
    guild: { id: "g" },
    config: { logs_enabled: true, log_moderation_channel_id: "c" },
    action: "automod",
    targetId: "u",
    reason: "AutoMod: AUTOMOD_LINK",
    rule: "AUTOMOD_LINK",
    rules: ["AUTOMOD_LINK", "AUTOMOD_BAD_WORD"],
    mapper: { map: (x) => x },
    service: { resolveDestination: () => "c" },
    delivery: { deliver: async (e) => e },
  });
  assert.equal(entry.details.targetId, "u");
  assert.equal(entry.details.reason, "AutoMod: AUTOMOD_LINK");
  assert.equal(entry.details.rule, "AUTOMOD_LINK");
  assert.deepEqual(entry.details.rules, ["AUTOMOD_LINK", "AUTOMOD_BAD_WORD"]);
});

test("Logs disabled or missing channel does not deliver automod log", async () => {
  const disabled = await handleModerationEvent({
    guild: { id: "g" },
    config: { logs_enabled: false },
    action: "automod",
    targetId: "u",
    mapper: { map: (x) => x },
    service: { resolveDestination: () => "c" },
    delivery: { deliver: async () => { throw new Error("should not deliver"); } },
  });
  assert.equal(disabled, null);

  const missing = await handleModerationEvent({
    guild: { id: "g" },
    config: { logs_enabled: true, log_moderation_channel_id: null },
    action: "automod",
    targetId: "u",
    mapper: { map: (x) => x },
    service: { resolveDestination: () => null },
    delivery: { deliver: async (e) => ({ delivered: false, ...e }) },
  });
  assert.equal(missing.delivered, false);
});

test("AutoMod does not fail when logs runtime throws", async () => {
  const config = { automod_enabled: true, automod_anti_links: true };
  const runtime = createAutoModRuntime({
    configService: configServiceFor(config),
    enforcerFactory: () => ({ deleteMessage: async () => true, timeoutUser: async () => ({ ok: true }), warnUser: async () => ({ ok: true }) }),
    logsRuntimeFactory: () => ({
      disabled: false,
      handleModerationEvent: async () => { throw new Error("log fail"); },
    }),
  });
  const result = await runtime.handleMessage(linkMessage("https://x"));
  assert.equal(result.matched, true);
  assert.equal(result.code, "AUTOMOD_LINK");
});

test("AutoMod logs disabled skips Logs Foundation", async () => {
  const config = { automod_enabled: true, automod_anti_links: true };
  let called = false;
  const runtime = createAutoModRuntime({
    configService: configServiceFor(config),
    enforcerFactory: () => ({ deleteMessage: async () => true, timeoutUser: async () => ({ ok: true }), warnUser: async () => ({ ok: true }) }),
    logsRuntimeFactory: () => ({ disabled: true, handleModerationEvent: async () => { called = true; } }),
  });
  await runtime.handleMessage(linkMessage("https://x"));
  assert.equal(called, false);
});
