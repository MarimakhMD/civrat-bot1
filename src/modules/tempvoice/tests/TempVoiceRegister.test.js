"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { InteractionRegistry } = require("../../../core/interactions");
const { PermissionName } = require("../../../core/permissions");
const { registerTempVoice } = require("../register");
const { TempVoiceComponentId: Id } = require("../configuration/tempVoiceConstants");

test("TempVoice registers ManageGuild routes", () => {
  const registry = new InteractionRegistry();
  const service = { read: async () => ({}), update: async () => ({}) };
  registerTempVoice({ registry, service, settingsHome: async () => {} });
  for (const id of [Id.SECTION, Id.TOGGLE, Id.BACK]) {
    const route = registry.find({ kind: "button", customId: id });
    assert.ok(route);
    assert.deepEqual(route.permissions.allOf, [PermissionName.MANAGE_GUILD]);
  }
  for (const id of [Id.LOBBY_CHANNEL, Id.CATEGORY_CHANNEL]) {
    const route = registry.find({ kind: "select-menu", customId: id });
    assert.ok(route);
    assert.deepEqual(route.permissions.allOf, [PermissionName.MANAGE_GUILD]);
  }
});
