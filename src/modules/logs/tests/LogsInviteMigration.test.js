"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { handleInviteEvent } = require("../events/handleInviteEvent");

test("invite events deliver once when enabled", async () => {
  for (const action of ["invite_created", "invite_deleted", "invite_used"]) {
    let calls = 0;
    const result = await handleInviteEvent({
      guild: { id: "g" },
      config: { logs_enabled: true, invitations_enabled: true, invitations_log_channel_id: "c" },
      action,
      inviteCode: "x",
      mapper: { map: (entry) => entry },
      service: { resolveDestination: () => "c" },
      delivery: { deliver: async (entry) => { calls += 1; return { delivered: true, ...entry }; } },
    });
    assert.equal(calls, 1);
    assert.equal(result.guildId, "g");
  }
});
