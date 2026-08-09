"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { testWelcome } = require("../interactions/testWelcome");

test("test Welcome sends the configured message and confirms success", async () => {
  const sent = [];
  const replies = [];
  await testWelcome({
    guildId: "guild",
    t: (key) => key,
    settings: { get: async () => ({ welcome_enabled: true, welcome_channel_id: "channel", welcome_message: "Hello", welcome_embed_enabled: false }) },
    envelope: {
      transport: {
        sendTestWelcome: async (payload) => sent.push(payload),
        reply: async (payload) => replies.push(payload),
      },
    },
  });
  assert.equal(sent[0].channelId, "channel");
  assert.equal(replies.length, 1);
});

test("test Welcome rejects incomplete configuration", async () => {
  await assert.rejects(() => testWelcome({
    guildId: "guild",
    t: (key) => key,
    settings: { get: async () => ({ welcome_enabled: false, welcome_channel_id: null }) },
    envelope: { transport: {} },
  }));
});
