"use strict";

// P12.2 (B1) — intégration runtime du chemin /ticketpanel : le panneau est
// envoyé dans le SALON TEXTE de l'interaction, jamais vers la catégorie de
// configuration. Hors ligne (pas de Supabase) : resolver Premium fail-closed =>
// rendu Free historique. Validation réelle Discord impossible offline.

const test = require("node:test");
const assert = require("node:assert/strict");

// Store de config partagé patché avant toute construction de runtime (même
// rôle que la table guild_configs en production). g : sans langue => FR par
// défaut ; gen : language "en" => panneau en anglais (P17).
const store = {
  g: { tickets_enabled: true, ticket_category_id: "cat-1", ticket_support_role_id: "role-1" },
  gen: { tickets_enabled: true, ticket_category_id: "cat-1", ticket_support_role_id: "role-1", language: "en" },
};
const guildConfigModule = require("../../src/services/guildConfig");
const originalGet = guildConfigModule.getGuildConfig;
guildConfigModule.getGuildConfig = async (guildId) => (store[guildId] ? { ...store[guildId] } : {});

const ticketpanelCommand = require("../../src/commands/ticketpanel");

function makeInteraction({ guildId, channel }) {
  const sent = [];
  const textChannel = {
    id: channel.id,
    isTextBased: () => true,
    send: async (payload) => { sent.push(payload); },
  };
  const category = { id: "cat-1", isTextBased: () => false };
  const guild = {
    id: guildId,
    channels: { cache: { get: (id) => (id === "cat-1" ? category : id === textChannel.id ? textChannel : null) } },
  };
  const captured = { reply: null };
  return { guild, channel: textChannel, reply: async (p) => { captured.reply = p; }, captured, sent };
}

test("/ticketpanel delivers the panel to the invoking text channel, never the category", async () => {
  const interaction = makeInteraction({ guildId: "g", channel: { id: "chan-home" } });
  await ticketpanelCommand.execute(interaction);
  assert.equal(interaction.sent.length, 1, "the panel must be sent exactly once");
  const payload = interaction.sent[0];
  assert.ok(JSON.stringify(payload.components).includes("civrat:v1:tickets:create"), "stable create custom id");
  assert.equal(payload.embeds.length, 1);
  // P17 : rendu Free réellement TRADUIT — fini les clés brutes dans le panneau.
  // Guilde sans langue configurée => FR par défaut (resolveGuildLocale).
  assert.equal(payload.embeds[0].data.title, "🎫 Tickets");
  assert.equal(payload.embeds[0].data.description, "Cliquez ci-dessous pour créer un ticket.");
  assert.equal(payload.components[0].components[0].data.label, "Créer un ticket");
  assert.ok(interaction.captured.reply, "the command must reply to the admin");
  assert.ok(interaction.captured.reply.content.includes("chan-home"), "reply must name the invoking text channel");
  assert.ok(!interaction.captured.reply.content.includes("cat-1"), "reply must never name the category");
  // Et surtout : la cible de l'envoi était le salon texte (preuve par le mock ci-dessus — la catégorie n'a pas de send()).
});

test("/ticketpanel renders English when the guild language is en", async () => {
  const interaction = makeInteraction({ guildId: "gen", channel: { id: "chan-en" } });
  await ticketpanelCommand.execute(interaction);
  assert.equal(interaction.sent.length, 1);
  const payload = interaction.sent[0];
  assert.equal(payload.embeds[0].data.title, "🎫 Tickets");
  assert.equal(payload.embeds[0].data.description, "Click below to create a ticket.");
  assert.equal(payload.components[0].components[0].data.label, "Create a ticket");
});

test("/ticketpanel on an unconfigured guild keeps the historical error path (no send)", async () => {
  const interaction = makeInteraction({ guildId: "g2", channel: { id: "chan-any" } });
  await ticketpanelCommand.execute(interaction);
  assert.equal(interaction.sent.length, 0, "no configured tickets means no panel sent");
  assert.ok(interaction.captured.reply.content.includes("TICKETS_DISABLED"));
});

test("regression B1: a category destination is structurally refused by the transport guard", async () => {
  const { TicketPanelDeliveryService } = require("../../src/modules/tickets/services/TicketPanelDeliveryService");
  const { DiscordTicketTransport } = require("../../src/adapters/discord/DiscordTicketTransport");
  const category = { id: "cat-1", isTextBased: () => false };
  const guild = { channels: { cache: { get: () => category } } };
  const delivery = new TicketPanelDeliveryService({
    panelService: { build: async () => ({ ready: true, view: { title: "t", content: "d", components: [{ customId: "c" }] } }) },
    transport: new DiscordTicketTransport({ guild }),
  });
  const result = await delivery.deliver("g", (k) => k, "cat-1");
  assert.equal(result.delivered, false);
  assert.equal(result.code, "TRANSPORT_ERROR", "a category is not text-based: sending there must stay impossible");
});

test.after(() => {
  guildConfigModule.getGuildConfig = originalGet;
});
