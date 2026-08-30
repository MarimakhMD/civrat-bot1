"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createDiscordMemberCapability } = require("../../../src/adapters/discord");
const { PermissionName } = require("../../../src/core/permissions");

const ROLE_ID = "1542958959907053688";

test("Discord member capability exposes core permissions and guild ownership", () => {
  const capability = createDiscordMemberCapability({
    id: "owner",
    permissions: { has: () => true },
    roles: { cache: { has: () => false } },
  }, "owner");
  assert.equal(capability.isGuildOwner, true);
  assert.equal(capability.has(PermissionName.MANAGE_GUILD), true);
});

test("Discord member capability exposes normalized role membership", () => {
  const capability = createDiscordMemberCapability({
    id: "member",
    permissions: { has: () => false },
    roles: { cache: { has: (roleId) => roleId === ROLE_ID } },
  }, "owner");
  assert.equal(capability.hasRole(ROLE_ID), true);
  assert.equal(capability.hasRole("999999999999999999"), false);
});

test("Discord member capability fails closed when member role data is unavailable", () => {
  assert.equal(createDiscordMemberCapability(null, null).hasRole(ROLE_ID), false);
  assert.equal(createDiscordMemberCapability({ id: "member" }, "owner").hasRole(ROLE_ID), false);
});
