"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { InteractionRegistry } = require("../../../core/interactions");
const { PermissionName } = require("../../../core/permissions");
const { registerAutoMod } = require("../register");
const { AutoModComponentId: Id } = require("../configuration/automodConstants");

function fakeService() {
  return { read: async () => ({}), update: async () => ({}) };
}

test("AutoMod registers ManageGuild-gated routes, a section, and a command", () => {
  const registry = new InteractionRegistry();
  const registration = registerAutoMod({ registry, service: fakeService(), settingsHome: async () => {} });

  for (const customId of [Id.SECTION, Id.TOGGLE, Id.DELETE_MESSAGE, Id.THRESHOLDS_OPEN, Id.BAD_WORDS_OPEN, Id.BACK]) {
    const route = registry.find({ kind: "button", customId });
    assert.ok(route, `expected route for ${customId}`);
    assert.deepEqual(route.permissions.allOf, [PermissionName.MANAGE_GUILD]);
  }

  const ruleRoute = registry.find({ kind: "button", customId: `${Id.TOGGLE_PREFIX}:antiLinks` });
  assert.ok(ruleRoute);
  assert.deepEqual(ruleRoute.permissions.allOf, [PermissionName.MANAGE_GUILD]);

  const enforceRoute = registry.find({ kind: "select-menu", customId: Id.ENFORCE_SELECT });
  assert.ok(enforceRoute);
  assert.deepEqual(enforceRoute.permissions.allOf, [PermissionName.MANAGE_GUILD]);

  const commandRoute = registry.find({ kind: "command", name: "automod" });
  assert.ok(commandRoute);
  assert.deepEqual(commandRoute.permissions.allOf, [PermissionName.MANAGE_GUILD]);

  assert.equal(registry.find({ kind: "button", customId: "automod:unknown" }), null);
  assert.ok(Array.isArray(registration.commands) && registration.commands.length === 1);
  assert.equal(registration.commands[0].name, "automod");
});
