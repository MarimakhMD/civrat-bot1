"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { SecurityBotService, SecurityBotReason } = require("../services/SecurityBotService");

const svc = new SecurityBotService();

test("non-bot members are always allowed", () => {
  assert.deepEqual(svc.check({ isBot: false, userId: "123", config: { security_anti_bot: true, security_whitelist: [] } }), { allowed: true, reason: SecurityBotReason.NOT_A_BOT });
  assert.deepEqual(svc.check({ isBot: false, userId: "123", config: null }), { allowed: true, reason: SecurityBotReason.NOT_A_BOT });
});

test("anti-bot disabled allows all bots", () => {
  assert.deepEqual(svc.check({ isBot: true, userId: "123", config: { security_anti_bot: false, security_whitelist: [] } }), { allowed: true, reason: SecurityBotReason.ANTI_BOT_DISABLED });
  assert.deepEqual(svc.check({ isBot: true, userId: "123", config: null }), { allowed: true, reason: SecurityBotReason.ANTI_BOT_DISABLED });
  assert.deepEqual(svc.check({ isBot: true, userId: "123", config: { security_anti_bot: false, security_whitelist: ["123"] } }), { allowed: true, reason: SecurityBotReason.ANTI_BOT_DISABLED });
});

test("whitelisted bots are allowed, non-whitelisted are blocked", () => {
  const config = { security_anti_bot: true, security_whitelist: ["111", "222"] };
  assert.deepEqual(svc.check({ isBot: true, userId: "111", config }), { allowed: true, reason: SecurityBotReason.BOT_WHITELISTED });
  assert.deepEqual(svc.check({ isBot: true, userId: "222", config }), { allowed: true, reason: SecurityBotReason.BOT_WHITELISTED });
  assert.deepEqual(svc.check({ isBot: true, userId: "999", config }), { allowed: false, reason: SecurityBotReason.BOT_NOT_WHITELISTED });
  assert.deepEqual(svc.check({ isBot: true, userId: null, config }), { allowed: false, reason: SecurityBotReason.BOT_NOT_WHITELISTED });
});

test("whitelist handles string and number IDs", () => {
  const config = { security_anti_bot: true, security_whitelist: [123, "456"] };
  assert.equal(svc.check({ isBot: true, userId: 123, config }).allowed, true);
  assert.equal(svc.check({ isBot: true, userId: "123", config }).allowed, true);
  assert.equal(svc.check({ isBot: true, userId: "456", config }).allowed, true);
  assert.equal(svc.check({ isBot: true, userId: 456, config }).allowed, true);
});

test("empty or missing whitelist blocks all bots when anti-bot enabled", () => {
  assert.deepEqual(svc.check({ isBot: true, userId: "123", config: { security_anti_bot: true, security_whitelist: [] } }), { allowed: false, reason: SecurityBotReason.BOT_NOT_WHITELISTED });
  assert.deepEqual(svc.check({ isBot: true, userId: "123", config: { security_anti_bot: true, security_whitelist: null } }), { allowed: false, reason: SecurityBotReason.BOT_NOT_WHITELISTED });
  assert.deepEqual(svc.check({ isBot: true, userId: "123", config: { security_anti_bot: true } }), { allowed: false, reason: SecurityBotReason.BOT_NOT_WHITELISTED });
});
