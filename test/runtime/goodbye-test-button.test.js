"use strict";

// Phase 3.2 — le bouton « Tester Goodbye » du panneau /settings doit réellement
// envoyer le message de test dans le salon configuré. Avant ce correctif, la
// route passait par WelcomeDeliveryService.goodbye() → transport.sendChannelMessage()
// qui n'existait pas sur DiscordResponseTransport : l'envoi échouait toujours et
// l'admin recevait « Le salon Goodbye est indisponible. » même avec une
// configuration valide. La livraison automatique au départ d'un membre utilise
// DiscordWelcomeGoodbyeTransport et ne doit pas changer.
// Hors ligne : interactions factices, aucun accès Discord/Supabase/MongoDB.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createGuildSettingsRuntime } = require("../../src/runtime/createGuildSettingsRuntime");
const { WelcomeGoodbyeComponentId: Id } = require("../../src/modules/welcome-goodbye/configuration/welcomeGoodbyeConstants");
const { DiscordWelcomeGoodbyeTransport } = require("../../src/adapters/discord/DiscordWelcomeGoodbyeTransport");

const CHANNEL_ID = "1234567890123456789";

function legacyConfig() {
  return {
    getGuildConfig: async () => ({
      language: "fr",
      goodbye_enabled: true,
      goodbye_channel_id: CHANNEL_ID,
      goodbye_message: "Au revoir {username} !",
      goodbye_embed_enabled: false,
    }),
    updateGuildConfig: async (_id, update) => update,
    invalidateCache: async () => {},
  };
}

function goodbyeTestInteraction({ captured, sent, resolveChannel }) {
  const channel = resolveChannel ? { isTextBased: () => true, send: async (message) => { sent.push(message); return message; } } : null;
  return {
    isChatInputCommand: () => false,
    isAutocomplete: () => false,
    isButton: () => true,
    isStringSelectMenu: () => false,
    isChannelSelectMenu: () => false,
    isRoleSelectMenu: () => false,
    isModalSubmit: () => false,
    customId: Id.TEST_GOODBYE,
    guildId: "g",
    user: { id: "u" },
    member: { id: "u", permissions: { has: () => true } },
    guild: { ownerId: "owner", channels: { cache: { get: (id) => (id === CHANNEL_ID ? channel : null) } } },
    reply: async (payload) => { captured.reply = payload; },
    followUp: async () => {},
    update: async (payload) => { captured.update = payload; },
  };
}

test("Tester Goodbye sends the configured message to the configured channel and confirms", async () => {
  const captured = {};
  const sent = [];
  const runtime = createGuildSettingsRuntime({ legacyConfigService: legacyConfig() });
  const handled = await runtime.tryHandle(goodbyeTestInteraction({ captured, sent, resolveChannel: true }));
  assert.equal(handled, true, "test-goodbye button not routed");
  assert.equal(sent.length, 1, "the farewell message must reach the configured channel");
  assert.ok(String(sent[0].content).startsWith("Au revoir"), `unexpected delivered content: ${sent[0].content}`);
  assert.equal(captured.reply?.content, "Message de test Goodbye envoyé.", "administrator confirmation missing");
});

test("Tester Goodbye keeps the existing error behaviour when the channel is unavailable", async () => {
  const captured = {};
  const sent = [];
  const runtime = createGuildSettingsRuntime({ legacyConfigService: legacyConfig() });
  const handled = await runtime.tryHandle(goodbyeTestInteraction({ captured, sent, resolveChannel: false }));
  assert.equal(handled, true);
  assert.equal(sent.length, 0, "nothing may be sent when the channel is unavailable");
  assert.equal(captured.reply?.content, "Le salon Goodbye est indisponible.", "existing localized error must be preserved");
});

test("automatic Goodbye delivery transport keeps its contract (pin: member-leave path unchanged)", async () => {
  const sent = [];
  const dm = [];
  const member = {
    guild: { channels: { cache: { get: () => ({ isTextBased: () => true, send: async (message) => { sent.push(message); return message; } }) } } },
    user: { send: async (message) => { dm.push(message); return message; } },
  };
  const transport = new DiscordWelcomeGoodbyeTransport(member);
  await transport.sendChannelMessage("c", { content: "Au revoir !", embed: null });
  assert.deepEqual(sent, [{ content: "Au revoir !" }]);
  await transport.sendDirectMessage("u", { content: "Bienvenue" });
  assert.deepEqual(dm, [{ content: "Bienvenue" }]);
});
