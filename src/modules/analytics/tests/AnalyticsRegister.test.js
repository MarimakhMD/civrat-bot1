"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { InteractionRegistry } = require("../../../core/interactions");
const { PermissionName } = require("../../../core/permissions");
const { registerAnalytics } = require("../register");

test("Analytics registers ManageGuild overview and public xp/invites commands", () => {
  const registry = new InteractionRegistry();
  const configService = { read: async () => ({}), update: async () => ({}) };
  const analyticsService = { getStats: async () => ({ messages: 0, members: 0 }), getTopXP: async () => [], getTopInvites: async () => [] };
  registerAnalytics({ registry, configService, analyticsService, settingsHome: async () => {} });
  const overview = registry.find({ kind: "command", name: "analytics" });
  assert.ok(overview);
  assert.deepEqual(overview.permissions.allOf, [PermissionName.MANAGE_GUILD]);
  const xp = registry.find({ kind: "command", name: "analytics_xp" });
  assert.ok(xp);
  assert.equal(xp.permissions, null);
  const invites = registry.find({ kind: "command", name: "analytics_invites" });
  assert.ok(invites);
  assert.equal(invites.permissions, null);
  const section = registry.find({ kind: "button", customId: "civrat:v1:analytics:section" });
  assert.ok(section);
  assert.deepEqual(section.permissions.allOf, [PermissionName.MANAGE_GUILD]);
});
