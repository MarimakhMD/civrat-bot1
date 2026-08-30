"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { AuthorizationError } = require("../../src/core/errors");
const { PermissionName, PermissionService } = require("../../src/core/permissions");
const { createFakeGuildMember } = require("../../src/core/testing/fakeGuildMember");

function context(permissions, isGuildOwner = false) {
  return { guildId: "guild", userId: "user", member: createFakeGuildMember({ permissions, isGuildOwner }) };
}

test("permission service evaluates Discord-adapter capabilities", async () => {
  const service = new PermissionService();
  assert.equal((await service.evaluate(context([PermissionName.ADMINISTRATOR]), { allOf: [PermissionName.ADMINISTRATOR] })).granted, true);
  assert.equal((await service.evaluate(context([PermissionName.MANAGE_GUILD]), { allOf: [PermissionName.MANAGE_GUILD] })).granted, true);
  assert.equal((await service.evaluate(context([PermissionName.MANAGE_ROLES]), { allOf: [PermissionName.MANAGE_ROLES] })).granted, true);
  assert.equal((await service.evaluate(context([PermissionName.MANAGE_CHANNELS]), { allOf: [PermissionName.MANAGE_CHANNELS] })).granted, true);
  assert.equal((await service.evaluate(context([], true), { allOf: [PermissionName.GUILD_OWNER] })).granted, true);
});

test("permission service supports allOf, anyOf, and safe default authority denial", async () => {
  const service = new PermissionService();
  const member = context([PermissionName.MANAGE_GUILD]);
  assert.equal((await service.evaluate(member, { allOf: [PermissionName.MANAGE_GUILD], anyOf: [PermissionName.ADMINISTRATOR, PermissionName.MANAGE_GUILD] })).granted, true);
  assert.equal((await service.evaluate(member, { allOf: [PermissionName.CIVRAT_OWNER] })).granted, false);
  assert.equal((await service.evaluate(member, { allOf: [PermissionName.CIVRAT_ADMIN] })).granted, false);
  await assert.rejects(() => service.require(member, { allOf: [PermissionName.MANAGE_ROLES] }), AuthorizationError);
});

test("CIVRAT_ADMIN delegates the complete context to the injected authority", async () => {
  const seen = [];
  const service = new PermissionService({
    civratAdminProvider: {
      isAdmin: async (candidate) => {
        seen.push(candidate);
        return candidate.guildId === "guild" && candidate.channelId === "channel";
      },
    },
  });
  const candidate = {
    ...context([]),
    channelId: "channel",
  };
  assert.equal((await service.evaluate(candidate, { allOf: [PermissionName.CIVRAT_ADMIN] })).granted, true);
  assert.deepEqual(seen, [candidate]);
});
