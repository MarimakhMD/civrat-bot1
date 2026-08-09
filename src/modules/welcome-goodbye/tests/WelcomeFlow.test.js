"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { toggleWelcome } = require("../interactions/updateWelcomeSettings");
const { selectWelcomeGoodbyeChannel } = require("../interactions/selectWelcomeGoodbyeChannel");
const { WelcomeGoodbyeComponentId: Id } = require("../configuration/welcomeGoodbyeConstants");

test("Welcome administrator flow persists activation and selected channel", async () => {
  let config = { welcome_enabled: false, welcome_channel_id: null };
  const updates = [];
  const context = {
    guildId: "guild",
    t: (key) => key,
    envelope: { transport: { update: async () => {} } },
    settings: {
      get: async () => config,
      update: async (_guildId, patch) => {
        updates.push(patch);
        config = { ...config, ...patch };
        return config;
      },
    },
  };

  await toggleWelcome(context);
  await selectWelcomeGoodbyeChannel({
    ...context,
    envelope: {
      customId: Id.WELCOME_CHANNEL,
      values: ["123456789012345"],
      transport: { update: async () => {} },
    },
  });

  assert.equal(config.welcome_enabled, true);
  assert.equal(config.welcome_channel_id, "123456789012345");
  assert.equal(updates.length, 2);
});
