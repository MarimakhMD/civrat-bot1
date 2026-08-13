"use strict";

// Phase 10.2 — extensions additives du transport de réponses : replyEmbed
// (aperçu du panneau Premium) et style « paragraph » des modales.

const test = require("node:test");
const assert = require("node:assert/strict");
const { TextInputStyle } = require("discord.js");
const { DiscordResponseTransport, MAX_ACTION_ROWS } = require("../../../src/adapters/discord/DiscordResponseTransport");

test("replyEmbed renders title, description, color, image and packed components ephemerally", async () => {
  const calls = { reply: [], followUp: [] };
  const transport = new DiscordResponseTransport({
    replied: false,
    deferred: false,
    reply: async (payload) => calls.reply.push(payload),
    followUp: async (payload) => calls.followUp.push(payload),
  });
  await transport.replyEmbed({
    embed: { title: "Titre", description: "Description", color: "#8061ef", image: "https://cdn.example.com/p.png" },
    components: [{ type: "button", customId: "civrat:v1:tickets:create", label: "Créer un ticket", style: "primary" }],
    ephemeral: true,
  });
  assert.equal(calls.reply.length, 1);
  assert.equal(calls.followUp.length, 0);
  const data = calls.reply[0];
  assert.equal(data.ephemeral, true);
  const embed = data.embeds[0].data;
  assert.equal(embed.title, "Titre");
  assert.equal(embed.description, "Description");
  assert.equal(embed.color, 0x8061ef);
  assert.equal(embed.image.url, "https://cdn.example.com/p.png");
  assert.ok(data.components.length <= MAX_ACTION_ROWS);
  assert.equal(data.components[0].components[0].data.custom_id, "civrat:v1:tickets:create");
});

test("replyEmbed follows up when the interaction was already answered and omits unset embed parts", async () => {
  const calls = { reply: [], followUp: [] };
  const transport = new DiscordResponseTransport({
    replied: true,
    deferred: false,
    reply: async (payload) => calls.reply.push(payload),
    followUp: async (payload) => calls.followUp.push(payload),
  });
  await transport.replyEmbed({ embed: { title: "Titre", description: "Sans couleur ni image", color: null, image: null } });
  assert.equal(calls.reply.length, 0);
  assert.equal(calls.followUp.length, 1);
  const embed = calls.followUp[0].embeds[0].data;
  assert.equal(embed.color, undefined);
  assert.equal(embed.image, undefined);
});

test("showModal honors the paragraph style only when requested", async () => {
  let modal = null;
  const transport = new DiscordResponseTransport({ showModal: async (builder) => { modal = builder; } });
  await transport.showModal({
    customId: "m",
    title: "Modale",
    fields: [
      { id: "short_field", label: "Court", required: false },
      { id: "long_field", label: "Long", required: false, style: "paragraph" },
    ],
  });
  const rows = modal.toJSON().components;
  assert.equal(rows[0].components[0].style, TextInputStyle.Short);
  assert.equal(rows[1].components[0].style, TextInputStyle.Paragraph);
});
