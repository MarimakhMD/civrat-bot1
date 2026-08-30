"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ErrorCode } = require("../../../src/core/errors");
const {
  AcknowledgementState,
  DiscordResponseTransport,
} = require("../../../src/adapters/discord/DiscordResponseTransport");

function interaction(overrides = {}) {
  return {
    replied: false,
    deferred: false,
    reply: async () => "reply",
    followUp: async () => "follow-up",
    update: async () => "update",
    editReply: async () => "edit",
    deferReply: async () => "deferred-reply",
    deferUpdate: async () => "deferred-update",
    showModal: async () => "modal",
    ...overrides,
  };
}

function view(content = "ok") {
  return { view: { content, components: [] }, ephemeral: true };
}

test("response transport follows up after an interaction is already replied", async () => {
  const calls = [];
  const transport = new DiscordResponseTransport(interaction({
    replied: true,
    followUp: async () => calls.push("follow-up"),
  }));
  await transport.reply(view());
  assert.deepEqual(calls, ["follow-up"]);
  assert.equal(transport.acknowledgementState(), AcknowledgementState.REPLIED);
});

test("reply completes deferReply with editReply and removes the immutable ephemeral flag", async () => {
  const calls = [];
  const transport = new DiscordResponseTransport(interaction({
    deferReply: async (payload) => calls.push(["deferReply", payload]),
    editReply: async (payload) => calls.push(["editReply", payload]),
  }));

  await transport.deferReply({ ephemeral: true });
  await transport.reply(view("completed"));

  assert.equal(calls[0][0], "deferReply");
  assert.equal(calls[1][0], "editReply");
  assert.equal(Object.hasOwn(calls[1][1], "ephemeral"), false);
  assert.equal(calls[1][1].content, "completed");
  assert.equal(transport.acknowledgementState(), AcknowledgementState.REPLIED);
});

test("response transport edits a deferred interaction instead of updating it", async () => {
  const calls = [];
  const transport = new DiscordResponseTransport(interaction({
    deferred: true,
    editReply: async () => calls.push("edit"),
  }));
  await transport.update(view());
  assert.deepEqual(calls, ["edit"]);
});

test("concurrent first replies are serialized into one reply and one follow-up", async () => {
  const calls = [];
  const transport = new DiscordResponseTransport(interaction({
    reply: async (payload) => calls.push(["reply", payload.content]),
    followUp: async (payload) => calls.push(["followUp", payload.content]),
  }));

  await Promise.all([transport.reply(view("first")), transport.reply(view("second"))]);
  assert.deepEqual(calls, [["reply", "first"], ["followUp", "second"]]);
});

test("deferReply is idempotent inside one transport", async () => {
  let calls = 0;
  const transport = new DiscordResponseTransport(interaction({ deferReply: async () => { calls += 1; } }));
  await transport.deferReply({ ephemeral: true });
  const reused = await transport.deferReply({ ephemeral: true });
  assert.equal(calls, 1);
  assert.deepEqual(reused, {
    acknowledged: true,
    reused: true,
    state: AcknowledgementState.DEFERRED_REPLY,
  });
});

test("a concurrent Discord 40060 on reply recovers with a follow-up", async () => {
  const calls = [];
  const alreadyAcknowledged = Object.assign(new Error("private detail"), { code: 40060, status: 400 });
  const transport = new DiscordResponseTransport(interaction({
    reply: async () => { throw alreadyAcknowledged; },
    followUp: async (payload) => calls.push(payload.content),
  }));

  await transport.reply(view("recovered"));
  assert.deepEqual(calls, ["recovered"]);
  assert.equal(transport.isAcknowledged(), true);
});

test("Discord 10062 becomes terminal and is never retried as a follow-up", async () => {
  let followUps = 0;
  const expired = Object.assign(new Error("private detail"), { code: 10062, status: 404 });
  const transport = new DiscordResponseTransport(interaction({
    reply: async () => { throw expired; },
    followUp: async () => { followUps += 1; },
  }));

  await assert.rejects(
    () => transport.reply(view()),
    (error) => error.code === ErrorCode.INTERACTION_EXPIRED && error.terminal === true
  );
  assert.equal(followUps, 0);
});

test("a modal cannot be opened after an acknowledgement", async () => {
  const transport = new DiscordResponseTransport(interaction());
  await transport.deferUpdate();
  await assert.rejects(
    () => transport.showModal({ customId: "modal", title: "Modal", fields: [] }),
    (error) => error.code === ErrorCode.INTERACTION_ALREADY_ACKNOWLEDGED
  );
});

test("Discord response permission failures retain their dedicated code", async () => {
  const denied = Object.assign(new Error("private detail"), { code: 50013, status: 403 });
  const transport = new DiscordResponseTransport(interaction({ reply: async () => { throw denied; } }));
  await assert.rejects(
    () => transport.reply(view()),
    (error) => error.code === ErrorCode.DISCORD_PERMISSION_DENIED
  );
});
