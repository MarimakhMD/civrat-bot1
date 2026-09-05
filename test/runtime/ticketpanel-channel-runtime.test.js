"use strict";

// P12.2 (B1) — intégration runtime du chemin /ticketpanel : le panneau est
// envoyé dans le SALON TEXTE de l'interaction, jamais vers la catégorie de
// configuration. Hors ligne (pas de Supabase) : resolver Premium fail-closed =>
// rendu Free historique. Validation réelle Discord impossible offline.
//
// M8 — /ticketpanel crée désormais un panel PERSISTANT. Le chemin Discord est
// en trois temps (send sans composant → insert → edit des boutons), donc le
// mock de salon doit aussi exposer messages.fetch().edit().

const test = require("node:test");
const assert = require("node:assert/strict");

// Store de config partagé patché avant toute construction de runtime (même
// rôle que la table guild_configs en production). g : sans langue => FR par
// défaut ; gen : language "en" => panneau en anglais (P17).
const store = {
  g: { tickets_enabled: true, ticket_category_id: "111111111111111111", ticket_support_role_id: "222222222222222222" },
  gen: { tickets_enabled: true, ticket_category_id: "111111111111111111", ticket_support_role_id: "222222222222222222", language: "en" },
};
const guildConfigModule = require("../../src/services/guildConfig");
const originalGet = guildConfigModule.getGuildConfig;
guildConfigModule.getGuildConfig = async (guildId) => (store[guildId] ? { ...store[guildId] } : {});

const ticketpanelCommand = require("../../src/commands/ticketpanel");
const { _resetForTests } = require("../../src/modules/tickets/runtime/getTicketPanelRepository");

function makeInteraction({ guildId, channel }) {
  const sent = [];
  const edited = [];
  let nextMessage = 0;
  const messages = new Map();
  const textChannel = {
    id: channel.id,
    isTextBased: () => true,
    send: async (payload) => {
      sent.push(payload);
      const id = `msg-${++nextMessage}`;
      const message = { id, edit: async (p) => { edited.push(p); return { id }; } };
      messages.set(id, message);
      return message;
    },
    messages: { fetch: async (id) => messages.get(id) || null },
  };
  const category = { id: "111111111111111111", isTextBased: () => false };
  const guild = {
    id: guildId,
    channels: { cache: { get: (id) => (id === "111111111111111111" ? category : id === textChannel.id ? textChannel : null) } },
  };
  const captured = { reply: null };
  return { guild, channel: textChannel, reply: async (p) => { captured.reply = p; }, captured, sent, edited };
}

test.beforeEach(() => {
  // Le dépôt est un singleton mémoïsé : sans reset, les panels des tests
  // précédents s'accumuleraient et le plafond de 10 finirait par tomber.
  _resetForTests();
});

test("/ticketpanel delivers the panel to the invoking text channel, never the category", async () => {
  const interaction = makeInteraction({ guildId: "g", channel: { id: "chan-home" } });
  await ticketpanelCommand.execute(interaction);
  assert.equal(interaction.sent.length, 1, "the panel must be sent exactly once");
  assert.equal(interaction.edited.length, 1, "M8: buttons are added by a single edit");

  // M8 — le premier envoi ne porte AUCUN composant : aucun customId invalide
  // n'est exposé pendant la fenêtre où le panelId n'existe pas encore.
  assert.deepEqual(interaction.sent[0].components, []);

  const payload = interaction.edited[0];
  assert.match(
    JSON.stringify(payload.components),
    /civrat:v1:tickets:create:\d+:0/,
    "M8: the create custom id now carries the panel id and the button index",
  );
  assert.equal(payload.embeds.length, 1);
  // P17 : rendu Free réellement TRADUIT — fini les clés brutes dans le panneau.
  // Guilde sans langue configurée => FR par défaut (resolveGuildLocale).
  assert.equal(payload.embeds[0].data.title, "🎫 Tickets");
  assert.equal(payload.embeds[0].data.description, "Cliquez ci-dessous pour créer un ticket.");
  assert.equal(payload.components[0].components[0].data.label, "Créer un ticket");
  assert.ok(interaction.captured.reply, "the command must reply to the admin");
  assert.ok(interaction.captured.reply.content.includes("chan-home"), "reply must name the invoking text channel");
  assert.ok(!interaction.captured.reply.content.includes("111111111111111111"), "reply must never name the category");
  // Et surtout : la cible de l'envoi était le salon texte (preuve par le mock ci-dessus — la catégorie n'a pas de send()).
});

test("M8: /ticketpanel persists the panel, so it survives a restart", async () => {
  const interaction = makeInteraction({ guildId: "g", channel: { id: "chan-persist" } });
  await ticketpanelCommand.execute(interaction);

  // Le singleton est résolu à nouveau : c'est le même dépôt, et le panel y est.
  const { getTicketPanelRepository } = require("../../src/modules/tickets/runtime/getTicketPanelRepository");
  const panels = await getTicketPanelRepository().listActive("g");
  assert.equal(panels.length, 1);
  assert.equal(panels[0].channelId, "chan-persist");
  assert.ok(panels[0].messageId, "the Discord messageId is stored, not discarded");
  assert.equal(panels[0].buttons.length, 1);
  assert.equal(interaction.captured.reply.content.includes(panels[0].id), true, "the reply names the panel id");
});

test("/ticketpanel renders English when the guild language is en", async () => {
  const interaction = makeInteraction({ guildId: "gen", channel: { id: "chan-en" } });
  await ticketpanelCommand.execute(interaction);
  assert.equal(interaction.sent.length, 1);
  const payload = interaction.edited[0];
  assert.equal(payload.embeds[0].data.title, "🎫 Tickets");
  assert.equal(payload.embeds[0].data.description, "Click below to create a ticket.");
  assert.equal(payload.components[0].components[0].data.label, "Create a ticket");
});

test("/ticketpanel on an unconfigured guild keeps the historical error path (no send)", async () => {
  const interaction = makeInteraction({ guildId: "g2", channel: { id: "chan-any" } });
  await ticketpanelCommand.execute(interaction);
  assert.equal(interaction.sent.length, 0, "no configured tickets means no panel sent");
  // M8 — la réponse est désormais TRADUITE au lieu d'afficher un code brut.
  // Le chemin d'erreur historique est préservé : c'est bien TICKETS_DISABLED
  // (et non TICKET_CONFIG_INCOMPLETE) qui remonte pour une guilde non configurée.
  const fr = require("../../src/modules/tickets/translations/fr.json");
  assert.equal(interaction.captured.reply.content, fr.tickets.TICKETS_DISABLED);
});

test("regression B1: a category destination is structurally refused by the transport guard", async () => {
  const { TicketPanelDeliveryService } = require("../../src/modules/tickets/services/TicketPanelDeliveryService");
  const { DiscordTicketTransport } = require("../../src/adapters/discord/DiscordTicketTransport");
  const { InMemoryTicketPanelRepository } = require("../../src/modules/tickets/persistence/TicketPanelRepository");
  const category = { id: "111111111111111111", isTextBased: () => false };
  const guild = { channels: { cache: { get: () => category } } };
  const delivery = new TicketPanelDeliveryService({
    panelService: {
      build: async () => ({ ready: true, view: { title: "t", content: "d", components: [{ customId: "c" }] } }),
      defaultDraft: async () => ({ categoryId: "c", supportRoleId: "r", buttons: [{ label: "l" }] }),
    },
    transport: new DiscordTicketTransport({ guild }),
    panelRepository: new InMemoryTicketPanelRepository(),
  });
  const result = await delivery.deliver({
    guildId: "g",
    t: (k) => k,
    channelId: "111111111111111111",
    draft: { categoryId: "c", supportRoleId: "r", buttons: [{ label: "l" }] },
  });
  assert.equal(result.delivered, false);
  assert.equal(result.code, "TRANSPORT_ERROR", "a category is not text-based: sending there must stay impossible");
});

test.after(() => {
  guildConfigModule.getGuildConfig = originalGet;
});
