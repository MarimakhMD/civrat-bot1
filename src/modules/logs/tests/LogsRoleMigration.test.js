"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { handleRoleEvent } = require("../events/handleRoleEvent");

test("role events deliver exactly once with guild and role context", async () => {
  for (const action of ["role_created", "role_deleted", "role_updated"]) {
    let calls = 0;
    const result = await handleRoleEvent({
      guild: { id: "guild" },
      config: { logs_enabled: true, log_role_update_channel_id: "channel" },
      action,
      roleId: "role",
      mapper: { map: (entry) => entry },
      service: { resolveDestination: () => "channel" },
      delivery: { deliver: async (entry) => { calls += 1; return { delivered: true, ...entry }; } },
    });
    assert.equal(calls, 1);
    assert.equal(result.guildId, "guild");
    assert.equal(result.details.roleId, "role");
  }
});
