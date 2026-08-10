"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { WelcomeAdminAction } = require("../services/WelcomeAdminLogService");
const { WelcomeGoodbyeComponentId: Id } = require("../configuration/welcomeGoodbyeConstants");

test("Welcome free flow exposes centralized administrator actions", () => {
  assert.equal(typeof Id.TOGGLE_WELCOME, "string");
  assert.equal(typeof Id.WELCOME_CHANNEL, "string");
  assert.equal(typeof Id.TEST_WELCOME, "string");
  assert.equal(typeof WelcomeAdminAction.ENABLED, "string");
  assert.equal(typeof WelcomeAdminAction.CHANNEL_CHANGED, "string");
  assert.equal(typeof WelcomeAdminAction.TEST_SENT, "string");
});
