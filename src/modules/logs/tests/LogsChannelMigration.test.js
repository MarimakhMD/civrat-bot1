"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { handleChannelEvent } = require("../events/handleChannelEvent");

test("channel and thread events deliver once with context", async () => {
  for (const action of ["channel_created", "channel_deleted", "channel_updated", "thread_created", "thread_deleted"]) {
    let calls = 0;
    const result = await handleChannelEvent({
      channel: { id: "c", name: "name", guild: { id: "g" } },
      config: { logs_enabled: true, log_channel_update_channel_id: "l" },
      action,
      mapper: { map: (entry) => entry },
      service: { resolveDestination: () => "l" },
      delivery: { deliver: async (entry) => { calls += 1; return { delivered: true, ...entry }; } },
    });
    assert.equal(calls, 1);
    assert.equal(result.guildId, "g");
  }
});
