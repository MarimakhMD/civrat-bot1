"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { DiscordResponseTransport } = require("../../../src/adapters/discord/DiscordResponseTransport");

function interaction(overrides = {}) {
  return {
    replied: false,
    deferred: false,
    reply: async () => "reply",
    followUp: async () => "follow-up",
    update: async () => "update",
    editReply: async () => "edit",
    ...overrides,
  };
}

test("response transport follows up after an interaction is already replied", async () => {
  const calls = [];
  const transport = new DiscordResponseTransport(interaction({ replied: true, followUp: async () => calls.push("follow-up") }));
  await transport.reply({ view: { content: "ok", components: [] }, ephemeral: true });
  assert.deepEqual(calls, ["follow-up"]);
});

test("response transport edits a deferred interaction instead of updating it", async () => {
  const calls = [];
  const transport = new DiscordResponseTransport(interaction({ deferred: true, editReply: async () => calls.push("edit") }));
  await transport.update({ view: { content: "ok", components: [] } });
  assert.deepEqual(calls, ["edit"]);
});
