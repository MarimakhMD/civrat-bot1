"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { InteractionRegistry } = require("../../../core/interactions");
const { PermissionName } = require("../../../core/permissions");
const { registerCaptcha } = require("../register");
const { CaptchaComponentId: Id } = require("../configuration/captchaConstants");

test("Captcha routes require ManageGuild and unknown route is absent", () => {
  const registry = new InteractionRegistry();
  const service = { read: async () => ({}), update: async () => ({}) };
  registerCaptcha({ registry, service, settingsHome: async () => {} });

  // P-CAPT L1 : la sous-vue Avancé et ses deux selects reprennent MANAGE_GUILD.
  for (const id of [Id.SECTION, Id.TOGGLE, Id.PREVIEW, Id.RESET, Id.BACK, Id.ADVANCED, Id.FORCE_EXISTING]) {
    assert.deepEqual(registry.find({ kind: "button", customId: id }).permissions.allOf, [PermissionName.MANAGE_GUILD]);
  }
  for (const id of [Id.DURATION, Id.LIMITS, Id.UNVERIFIED_ROLE]) {
    assert.deepEqual(registry.find({ kind: "select-menu", customId: id }).permissions.allOf, [PermissionName.MANAGE_GUILD]);
  }
  assert.equal(registry.find({ kind: "button", customId: "captcha:unknown" }), null);
  assert.equal(registry.find({ kind: "select-menu", customId: "captcha:unknown" }), null);
});
