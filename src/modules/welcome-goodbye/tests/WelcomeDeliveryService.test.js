"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { WelcomeDeliveryService } = require("../services/WelcomeDeliveryService");
const { WelcomeTemplateRenderer, defaultPlaceholderProviders } = require("../services/WelcomeTemplateRenderer");

function createService(logService = null) {
  return new WelcomeDeliveryService({
    renderer: new WelcomeTemplateRenderer({ providers: defaultPlaceholderProviders() }),
    logService,
  });
}

test("delivery sends configured Welcome through an abstract transport", async () => {
  const sent = [];
  const service = createService();

  await service.welcome(
    { guildId: "guild", user: "@user" },
    {
      welcome_enabled: true,
      welcome_channel_id: "channel",
      welcome_message: "Hi {user}",
      welcome_embed_enabled: false,
    },
    { sendChannelMessage: async (...args) => sent.push(args) },
  );

  assert.deepEqual(sent, [["channel", { content: "Hi @user", embed: null }]]);
});

test("delivery records a structured failure before returning a safe error", async () => {
  const events = [];
  const service = createService({ failure: (event) => events.push(event) });

  await assert.rejects(
    () => service.welcome(
      { guildId: "guild", user: "@user" },
      { welcome_enabled: true, welcome_channel_id: "channel", welcome_message: "Hi", welcome_embed_enabled: false },
      { sendChannelMessage: async () => { throw new Error("Missing Permissions"); } },
    ),
  );

  assert.equal(events[0].guildId, "guild");
});
