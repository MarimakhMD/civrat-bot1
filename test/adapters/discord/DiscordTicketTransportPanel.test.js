"use strict";

// Phase 10.2 — rendu réel du panneau Tickets : la vue Free historique doit
// produire exactement le même payload Discord qu'avant, et la vue Premium
// (view.embed autorisée par le resolver) doit appliquer couleur et image.

const test = require("node:test");
const assert = require("node:assert/strict");
const { DiscordTicketTransport } = require("../../../src/adapters/discord/DiscordTicketTransport");

function captureSend() {
  const sent = [];
  const channel = { isTextBased: () => true, send: async (payload) => { sent.push(payload); } };
  const transport = new DiscordTicketTransport({ guild: { channels: { cache: { get: () => channel } } } });
  return { transport, sent };
}

const freeView = {
  title: "🎫 Tickets",
  content: "Cliquez ci-dessous pour créer un ticket.",
  components: [{ type: "button", customId: "civrat:v1:tickets:create", label: "Créer un ticket", style: "primary" }],
};

test("sendPanel renders the Free view exactly as before (no color, no image)", async () => {
  const { transport, sent } = captureSend();
  await transport.sendPanel("chan", freeView);
  assert.equal(sent.length, 1);
  const embed = sent[0].embeds[0].data;
  assert.equal(embed.title, "🎫 Tickets");
  assert.equal(embed.description, "Cliquez ci-dessous pour créer un ticket.");
  assert.equal(embed.color, undefined); // aucun setColor : rendu historique
  assert.equal(embed.image, undefined); // aucun setImage : rendu historique
  const button = sent[0].components[0].components[0].data;
  assert.equal(button.custom_id, "civrat:v1:tickets:create");
  assert.equal(button.label, "Créer un ticket");
});

test("sendPanel applies Premium color and image when the view carries them", async () => {
  const { transport, sent } = captureSend();
  const premiumView = { ...freeView, title: "Support Élite", embed: { color: "#8061ef", image: "https://cdn.example.com/panel.png" } };
  await transport.sendPanel("chan", premiumView);
  const embed = sent[0].embeds[0].data;
  assert.equal(embed.title, "Support Élite");
  assert.equal(embed.color, 0x8061ef);
  assert.equal(embed.image.url, "https://cdn.example.com/panel.png");
});

test("sendPanel with a Premium color but no image sets no image key", async () => {
  const { transport, sent } = captureSend();
  await transport.sendPanel("chan", { ...freeView, embed: { color: "#123456", image: null } });
  const embed = sent[0].embeds[0].data;
  assert.equal(embed.color, 0x123456);
  assert.equal(embed.image, undefined); // fallback propre : pas d'image
});

test("sendPanel still rejects an unavailable channel", async () => {
  const transport = new DiscordTicketTransport({ guild: { channels: { cache: { get: () => null } } } });
  await assert.rejects(() => transport.sendPanel("chan", freeView), /channel_unavailable/);
});
