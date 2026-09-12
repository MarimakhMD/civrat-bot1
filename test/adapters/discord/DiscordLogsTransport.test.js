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
  // P1c — les identifiants sont regroupés dans un unique champ « 🆔 IDs »,
  // puis les clés restantes sont rendues telles quelles.
  assert.equal(embed.fields.length, 3);
  const names = embed.fields.map((f) => f.name);
  assert.deepEqual(names, ["🆔 IDs", "count", "bot"]);
  const idsField = embed.fields.find((f) => f.name === "🆔 IDs");
  assert.equal(idsField.value, "message: MSG\nsalon: CH");
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
// P1c — ordre canonique des champs et « inconnu »
// ───────────────────────────────────────────────────────────────

test("P1c: l'ordre canonique Qui/Cible/Salon/Avant/Après/Raison/Invitation est respecté, puis les IDs", async () => {
  const { guild, sent } = makeGuild();
  const transport = new DiscordLogsTransport({ guild });
  await transport.deliver({
    channelId: "CH",
    title: "logs.member_kicked",
    details: {
      after: "après",
      who: "Modérateur (M1)",
      reason: "spam",
      target: "Cible (U1)",
      before: "avant",
      channel: "#général",
      invite: "abc123",
      targetId: "U1",
      moderatorId: "M1",
    },
  });
  const embed = deliveredEmbed(sent);
  const names = embed.fields.map((f) => f.name);
  assert.deepEqual(names, [
    "👤 Qui",
    "🎯 Cible",
    "📁 Salon",
    "📝 Avant",
    "✏️ Après",
    "💬 Raison",
    "🔗 Invitation",
    "🆔 IDs",
  ]);
  const ids = embed.fields.find((f) => f.name === "🆔 IDs");
  assert.equal(ids.value, "cible: U1\nmodérateur: M1");
});

test("P1c: who absent → champ omis ; who null → « inconnu » (jamais d'identité inventée)", async () => {
  const { guild, sent } = makeGuild();
  const transport = new DiscordLogsTransport({ guild });
  await transport.deliver({
    channelId: "CH",
    title: "logs.a",
    details: { target: "Cible (U1)" },
  });
  await transport.deliver({
    channelId: "CH",
    title: "logs.b",
    details: { target: "Cible (U1)", who: null },
  });
  assert.equal(sent.length, 2);
  const [first, second] = sent.map((p) => p.embeds[0].toJSON());
  assert.equal(first.fields.find((f) => f.name === "👤 Qui"), undefined);
  assert.equal(second.fields.find((f) => f.name === "👤 Qui").value, "inconnu");
});

// ───────────────────────────────────────────────────────────────
// Charte couleur + thumbnail + rendu membre (Join/Leave)
// ───────────────────────────────────────────────────────────────

function hexColor(embed) {
  const c = embed.color;
  return `#${c.toString(16).padStart(6, "0").toUpperCase()}`;
}

test("charte: member_joined → VERT, thumbnail avatar, champs membre dédiés dans l'ordre", async () => {
  const { guild, sent } = makeGuild();
  const transport = new DiscordLogsTransport({ guild });
  await transport.deliver({
    channelId: "CH",
    title: "logs.memberJoined",
    action: "member_joined",
    details: {
      member: "<@M> `Nouveau`",
      memberId: "M",
      createdAt: "2024-05-01",
      invite: "abc",
      inviter: "<@I> `Inviteur`",
      inviterStats: 7,
      memberCount: 42,
      avatarUrl: "https://cdn.discord/avatars/M.png",
    },
  });
  const embed = deliveredEmbed(sent);
  assert.equal(hexColor(embed), "#2ECC71");
  assert.equal(embed.thumbnail.url, "https://cdn.discord/avatars/M.png");
  assert.deepEqual(embed.fields.map((f) => f.name), [
    "👤 Membre", "🆔 ID", "📅 Compte créé", "🔗 Invitation utilisée", "🛡️ Invité par", "📊 Invitations du recruteur", "👥 Membres",
  ]);
  assert.equal(embed.fields.find((f) => f.name === "👤 Membre").value, "<@M> `Nouveau`");
  assert.equal(embed.fields.find((f) => f.name === "📊 Invitations du recruteur").value, "7");
});

test("charte: member_left → ROUGE, champs membre dédiés, createdAt/avatar absents omis", async () => {
  const { guild, sent } = makeGuild();
  const transport = new DiscordLogsTransport({ guild });
  await transport.deliver({
    channelId: "CH",
    title: "logs.memberLeft",
    action: "member_left",
    details: { member: "<@M>", memberId: "M", createdAt: null, memberCount: 41, avatarUrl: null },
  });
  const embed = deliveredEmbed(sent);
  assert.equal(hexColor(embed), "#E74C3C");
  assert.equal(embed.thumbnail, undefined);
  assert.deepEqual(embed.fields.map((f) => f.name), ["👤 Membre", "🆔 ID", "👥 Membres restants"]);
  assert.equal(embed.fields.find((f) => f.name === "👤 Membre").value, "<@M>");
});

test("charte: couleurs représentatives (rouge/vert/orange/bleu) sans avatar", async () => {
  const { guild, sent } = makeGuild();
  const transport = new DiscordLogsTransport({ guild });
  const cases = [
    ["message_deleted", "#E74C3C"],
    ["role_created", "#2ECC71"],
    ["message_updated", "#E67E22"],
    ["invite_used", "#3498DB"],
  ];
  for (const [action, expected] of cases) {
    await transport.deliver({ channelId: "CH", title: "logs.x", action, details: { target: "X" } });
  }
  assert.equal(sent.length, cases.length);
  for (let i = 0; i < cases.length; i++) {
    assert.equal(hexColor(sent[i].embeds[0].toJSON()), cases[i][1]);
  }
});

test("charte: entry.color explicite reste prioritaire sur la couleur de l'action", async () => {
  const { guild, sent } = makeGuild();
  const transport = new DiscordLogsTransport({ guild });
  await transport.deliver({ channelId: "CH", title: "logs.x", action: "member_joined", color: "#123456", details: { memberId: "M" } });
  assert.equal(hexColor(sent[0].embeds[0].toJSON()), "#123456");
});

// ───────────────────────────────────────────────────────────────
// Rendu DÉDIÉ par action : champs, ordre et couleur
// ───────────────────────────────────────────────────────────────

async function render(transport, action, details, color = null) {
  const { guild, sent } = makeGuild();
  const t = transport || new DiscordLogsTransport({ guild });
  await t.deliver({ channelId: "CH", title: "logs.x", action, color, details });
  return sent[0].embeds[0].toJSON();
}

const RENDER_CASES = [
  {
    name: "message_deleted",
    action: "message_deleted",
    color: "#E74C3C",
    details: { who: "Alice (A)", channel: "#général (CH)", before: "bonjour", messageId: "MSG", channelId: "CH", avatarUrl: "https://cdn.discord/avatars/A.png" },
    fields: ["👤 Auteur", "📁 Salon", "🗑️ Contenu supprimé", "🆔 Message", "🆔 Salon"],
  },
  {
    name: "message_updated",
    action: "message_updated",
    color: "#E67E22",
    details: { who: "Alice (A)", channel: "#général (CH)", before: "ancien", after: "nouveau", messageId: "MSG" },
    fields: ["👤 Auteur", "📁 Salon", "📝 Avant", "✏️ Après", "🆔 Message"],
  },
  {
    name: "messages_bulk_deleted",
    action: "messages_bulk_deleted",
    color: "#E74C3C",
    details: { channel: "#général (CH)", count: 12, before: "Alice (A) : bonjour" },
    fields: ["📁 Salon", "🔢 Nombre de messages", "📝 Messages supprimés"],
  },
  {
    name: "member_banned",
    action: "member_banned",
    color: "#E74C3C",
    details: { target: "<@U> `Alice`", targetId: "U", who: "Modo (M1)", reason: "spam" },
    fields: ["👤 Membre", "🆔 ID", "🛡️ Modérateur", "💬 Raison"],
  },
  {
    name: "member_unbanned",
    action: "member_unbanned",
    color: "#2ECC71",
    details: { target: "<@U> `Alice`", targetId: "U", who: "Modo (M1)" },
    fields: ["👤 Membre", "🆔 ID", "🛡️ Auteur"],
  },
  {
    name: "member_kicked",
    action: "member_kicked",
    color: "#E67E22",
    details: { target: "<@U> `Alice`", targetId: "U", who: "Modo (M1)", reason: "insultes" },
    fields: ["👤 Membre", "🆔 ID", "🛡️ Modérateur", "💬 Raison"],
  },
  {
    name: "member_timed_out",
    action: "member_timed_out",
    color: "#E67E22",
    details: { target: "<@U> `Alice`", targetId: "U", duration: "10 min", who: "Modo (M1)", reason: "spam" },
    fields: ["👤 Membre", "🆔 ID", "⏱️ Durée", "🛡️ Modérateur", "💬 Raison"],
  },
  {
    name: "member_untimeout",
    action: "member_untimeout",
    color: "#2ECC71",
    details: { target: "<@U> `Alice`", targetId: "U", who: "Modo (M1)" },
    fields: ["👤 Membre", "🆔 ID", "🛡️ Auteur"],
  },
  {
    name: "role_created",
    action: "role_created",
    color: "#2ECC71",
    details: { target: "@Modérateur (R1)", roleId: "R1", who: "Modo (M1)" },
    fields: ["🎭 Rôle", "🆔 ID", "🛡️ Auteur"],
  },
  {
    name: "role_deleted",
    action: "role_deleted",
    color: "#E74C3C",
    details: { target: "@Modérateur (R1)", roleId: "R1", who: "Modo (M1)" },
    fields: ["🎭 Rôle", "🆔 ID", "🛡️ Auteur"],
  },
  {
    name: "role_updated",
    action: "role_updated",
    color: "#E67E22",
    details: { target: "@Modérateur (R1)", roleId: "R1", before: "Modérateur", after: "Admin", who: "Modo (M1)" },
    fields: ["🎭 Rôle", "🆔 ID", "📝 Avant", "✏️ Après", "🛡️ Auteur"],
  },
  {
    name: "member_role_added",
    action: "member_role_added",
    color: "#2ECC71",
    details: { member: "<@U> `Alice`", target: "@Membre (R2)", who: "Modo (M1)" },
    fields: ["👤 Membre", "🎭 Rôle ajouté", "🛡️ Auteur"],
  },
  {
    name: "member_role_removed",
    action: "member_role_removed",
    color: "#E74C3C",
    details: { member: "<@U> `Alice`", target: "@Membre (R2)", who: "Modo (M1)" },
    fields: ["👤 Membre", "🎭 Rôle retiré", "🛡️ Auteur"],
  },
  {
    name: "channel_created",
    action: "channel_created",
    color: "#2ECC71",
    details: { target: "#général (C1)", channelType: "Texte", channelId: "C1", who: "Modo (M1)" },
    fields: ["📁 Salon", "🏷️ Type", "🆔 ID", "🛡️ Auteur"],
  },
  {
    name: "channel_deleted",
    action: "channel_deleted",
    color: "#E74C3C",
    details: { target: "#général (C1)", channelType: "Texte", channelId: "C1", who: "Modo (M1)" },
    fields: ["📁 Salon", "🏷️ Type", "🆔 ID", "🛡️ Auteur"],
  },
  {
    name: "channel_updated",
    action: "channel_updated",
    color: "#E67E22",
    details: { target: "#général (C1)", before: "général", after: "général-public", who: "Modo (M1)" },
    fields: ["📁 Salon", "📝 Avant", "✏️ Après", "🛡️ Auteur"],
  },
  {
    name: "thread_created",
    action: "thread_created",
    color: "#2ECC71",
    details: { target: "#sujet (T1)", parent: "#général (C1)", channelId: "T1", who: "Modo (M1)" },
    fields: ["🧵 Fil", "📁 Salon parent", "🆔 ID", "🛡️ Auteur"],
  },
  {
    name: "thread_deleted",
    action: "thread_deleted",
    color: "#E74C3C",
    details: { target: "#sujet (T1)", parent: "#général (C1)", channelId: "T1", who: "Modo (M1)" },
    fields: ["🧵 Fil", "📁 Salon parent", "🆔 ID", "🛡️ Auteur"],
  },
  {
    name: "invite_created",
    action: "invite_created",
    color: "#3498DB",
    details: { invite: "abc", who: "Alice (A1)", channel: "#général (C1)", expiresAt: "2026-09-12T10:00:00.000Z", uses: 3, maxUses: 10 },
    fields: ["🔗 Code", "🛡️ Créateur", "📁 Salon", "⏳ Expiration", "🔢 Utilisations", "🔢 Utilisations max"],
  },
  {
    name: "invite_deleted",
    action: "invite_deleted",
    color: "#E74C3C",
    details: { invite: "abc", who: "Alice (A1)", channel: "#général (C1)" },
    fields: ["🔗 Code", "🛡️ Créateur", "📁 Salon"],
  },
  {
    name: "invite_used",
    action: "invite_used",
    color: "#3498DB",
    details: { member: "<@U> `Nouveau`", invite: "abc", who: "<@I> `Alice`", avatarUrl: "https://cdn.discord/avatars/U.png" },
    fields: ["👤 Membre", "🔗 Invitation", "🛡️ Invité par"],
  },
  {
    name: "member_nickname_changed",
    action: "member_nickname_changed",
    color: "#E67E22",
    details: { member: "<@U> `Alice`", before: "alice", after: "Alice2", memberId: "U" },
    fields: ["👤 Membre", "📝 Ancien pseudo", "✏️ Nouveau pseudo"],
  },
];

for (const c of RENDER_CASES) {
  test(`rendu dédié: ${c.name} → champs et couleur`, async () => {
    const embed = await render(null, c.action, c.details);
    assert.equal(hexColor(embed), c.color);
    assert.deepEqual(embed.fields.map((f) => f.name), c.fields, `${c.name}: ordre des champs`);
  });
}

test("rendu dédié: un champ absent/null est omis (modérateur inconnu → pas de champ)", async () => {
  const embed = await render(null, "member_banned", { target: "<@U> `Alice`", targetId: "U", who: null, reason: null });
  assert.deepEqual(embed.fields.map((f) => f.name), ["👤 Membre", "🆔 ID"]);
});

test("rendu dédié: avatar réel en thumbnail, jamais en field", async () => {
  const embed = await render(null, "invite_used", {
    member: "<@U> `Nouveau`",
    invite: "abc",
    who: "<@I> `Alice`",
    avatarUrl: "https://cdn.discord/avatars/U.png",
  });
  assert.equal(embed.thumbnail.url, "https://cdn.discord/avatars/U.png");
  assert.equal(embed.fields.some((f) => f.name === "avatarUrl"), false);
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
