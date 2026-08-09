"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createAutoRoleRuntime } = require("../runtime/createAutoRoleRuntime");

test("runtime skips duplicate role without transport assignment", async () => {
  let adds = 0;
  const runtime = createAutoRoleRuntime({
    autoRoleService: {
      read: async () => ({ autorole_enabled: true, autorole_member_role_id: "r", autorole_bot_role_id: null }),
    },
  });
  const role = { id: "r", managed: false, position: 1 };
  const member = {
    id: "m",
    user: { bot: false },
    manageable: true,
    roles: {
      cache: new Map([["r", role]]),
      highest: { position: 2 },
      add: async () => { adds += 1; },
    },
    guild: {
      id: "g",
      roles: { cache: new Map([["r", role]]) },
      members: { me: { permissions: { has: () => true }, roles: { highest: { position: 2 } } } },
    },
  };
  const result = await runtime.handleMemberJoined(member);
  assert.equal(result.assigned, false);
  assert.equal(adds, 0);
});
