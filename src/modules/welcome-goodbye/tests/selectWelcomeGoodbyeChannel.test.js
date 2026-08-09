"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { selectWelcomeGoodbyeChannel, channelSelectView } = require("../interactions/selectWelcomeGoodbyeChannel");
const { WelcomeGoodbyeComponentId: Id, WelcomeGoodbyeConfigKey: Key } = require("../configuration/welcomeGoodbyeConstants");

test("Welcome channel selection persists and refreshes the panel", async () => {
  const calls = [];
  const updates = [];
  await selectWelcomeGoodbyeChannel({
    guildId: "g",
    t: (key) => key,
    envelope: { customId: Id.WELCOME_CHANNEL, values: ["123456789012345"], transport: { update: async (value) => updates.push(value) } },
    settings: {
      get: async () => ({ welcome_enabled: true }),
      update: async (...args) => { calls.push(args); return { welcome_enabled: true, [Key.WELCOME_CHANNEL]: "123456789012345" }; },
    },
  });
  assert.deepEqual(calls, [["g", { [Key.WELCOME_CHANNEL]: "123456789012345" }]]);
  assert.equal(updates.length, 1);
});

test("channel select view is transport neutral", () => {
  assert.equal(channelSelectView({ customId: Id.GOODBYE_CHANNEL, placeholder: "Choose" }).type, "channel-select");
});
