"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { DiscordLogsTransport } = require("../../../src/adapters/discord/DiscordLogsTransport");

function makeGuild(overrides = {}) {
  const sent = [];
  const channel = {
    isTextBased: () => true,
    send: async (payload) => {
      sent.push(payload);
      return { id: "SENT" };
    },
  };
  const cache = new Map([["CH", channel]]);
  const guild = {
    channels: { cache },
    ...overrides,
  };
  return { guild, sent, channel };
}

function deliveredEmbed(sent) {
  assert.equal(sent.length, 1, "un seul envoi attendu");
  return sent[0].embeds[0].toJSON();
}

// ───────────────────────────────────────────────────────────────
// P0 — l'embed est toujours valide (aucune chaîne vide)
// ───────────────────────────────────────────────────────────────

test("P0: un événement sans description n'appelle pas setDescription(\"\")", async () => {
  const { guild, sent } = makeGuild();
  const transport = new DiscordLogsTransport({ guild });
  await transport.deliver({
    channelId: "CH",
    title: "logs.message_updated",
    category: "messages",
    action: "message_updated",
    details: { messageId: "M" },
  });
  const embed = deliveredEmbed(sent);
  assert.equal(embed.title, "logs.message_updated");
  assert.equal(embed.description, undefined);
  assert.equal(embed.timestamp !== undefined, true);
});

test("P0: description explicitement vide est omise (pas de throw)", async () => {
  const { guild, sent } = makeGuild();
  const transport = new DiscordLogsTransport({ guild });
  await transport.deliver({
    channelId: "CH",
    title: "logs.x",
    description: "",
    details: {},
  });
  const embed = deliveredEmbed(sent);
  assert.equal(embed.description, undefined);
});

test("P0: titre vide retombe sur le libellé par défaut non vide", async () => {
  const { guild, sent } = makeGuild();
  const transport = new DiscordLogsTransport({ guild });
  await transport.deliver({ channelId: "CH", title: "", details: {} });
  const embed = deliveredEmbed(sent);
  assert.equal(embed.title, "Log");
});

test("P0: titre ne contenant que des espaces est aussi assaini", async () => {
  const { guild, sent } = makeGuild();
  const transport = new DiscordLogsTransport({ guild });
  await transport.deliver({ channelId: "CH", title: "   ", details: {} });
  const embed = deliveredEmbed(sent);
  assert.equal(embed.title, "Log");
});

// ───────────────────────────────────────────────────────────────
// P1 — entry.details rendu en fields, valeurs invalides filtrées
// ───────────────────────────────────────────────────────────────

test("P1: les détails deviennent des fields, valeurs nulles/vides ignorées", async () => {
  const { guild, sent } = makeGuild();
  const transport = new DiscordLogsTransport({ guild });
  await transport.deliver({
    channelId: "CH",
    title: "logs.message_deleted",
    details: {
      messageId: "MSG",
      channelId: "CH",
      authorId: null,        // partiel → ignoré, aucune info fabriquée
      reason: "",
      memberId: undefined,
      count: 5,              // nombre → String(...)
      bot: true,             // booléen → String(...)
    },
  });
  const embed = deliveredEmbed(sent);
  assert.ok(Array.isArray(embed.fields), "fields présents");
  assert.equal(embed.fields.length, 4);
  const names = embed.fields.map((f) => f.name);
  assert.deepEqual(names, ["messageId", "channelId", "count", "bot"]);
  const countField = embed.fields.find((f) => f.name === "count");
  assert.equal(countField.value, "5");
  const botField = embed.fields.find((f) => f.name === "bot");
  assert.equal(botField.value, "true");
});

test("P1: name tronqué à 256 et value à 1024", async () => {
  const { guild, sent } = makeGuild();
  const transport = new DiscordLogsTransport({ guild });
  const longName = "k".repeat(300);
  const longValue = "v".repeat(2000);
  await transport.deliver({
    channelId: "CH",
    title: "logs.x",
    details: { [longName]: longValue },
  });
  const embed = deliveredEmbed(sent);
  assert.equal(embed.fields.length, 1);
  assert.equal(embed.fields[0].name.length, 256);
  assert.equal(embed.fields[0].value.length, 1024);
});

test("P1: maximum 25 fields respecté", async () => {
  const { guild, sent } = makeGuild();
  const transport = new DiscordLogsTransport({ guild });
  const details = {};
  for (let i = 0; i < 40; i++) details[`key${i}`] = `value${i}`;
  await transport.deliver({ channelId: "CH", title: "logs.x", details });
  const embed = deliveredEmbed(sent);
  assert.equal(embed.fields.length, 25);
});

test("P1: détails non-objet (null / array / absent) ne produisent aucun field", async () => {
  const { guild, sent } = makeGuild();
  const transport = new DiscordLogsTransport({ guild });
  await transport.deliver({ channelId: "CH", title: "logs.x", details: null });
  await transport.deliver({ channelId: "CH", title: "logs.x", details: ["a", "b"] });
  await transport.deliver({ channelId: "CH", title: "logs.x" });
  assert.equal(sent.length, 3);
  for (const payload of sent) {
    const embed = payload.embeds[0].toJSON();
    assert.equal(embed.fields, undefined);
  }
});

// ───────────────────────────────────────────────────────────────
// Garde salon inchangée
// ───────────────────────────────────────────────────────────────

test("salon non textuel lève log_channel_unavailable", async () => {
  const guild = { channels: { cache: new Map([["CH", { isTextBased: () => false }]]) } };
  const transport = new DiscordLogsTransport({ guild });
  await assert.rejects(
    () => transport.deliver({ channelId: "CH", title: "logs.x", details: {} }),
    /log_channel_unavailable/,
  );
});
