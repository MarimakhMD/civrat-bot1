"use strict";

/**
 * PHASE 1 — rendu des journaux.
 *
 * Trois invariants vérifiés pour CHAQUE action du système :
 *  • le titre est traduit (jamais une clé `logs.xxx`, jamais le secours « Log ») ;
 *  • aucun nom de champ n'est une clé technique (`action`, `result`, `rule`…) :
 *    tout libellé provient de la table FR/EN du transport ;
 *  • l'embed n'est jamais vide, et il suit la langue de la guilde dans son
 *    intégralité, pas seulement pour le titre.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { DiscordLogsTransport, LABELS, ACTION_FIELDS } = require("../../src/adapters/discord/DiscordLogsTransport");
const { localizeTitle } = require("../../src/modules/logs/services/logTitles");
const { resolveLanguage } = require("../../src/modules/logs/services/logLanguage");
const fr = require("../../src/modules/logs/translations/fr.json");
const en = require("../../src/modules/logs/translations/en.json");

/** Toutes les actions pour lesquelles un rendu dédié existe. */
const ACTIONS = Object.keys(ACTION_FIELDS);

/** Tous les libellés légitimes, dans les deux langues. */
const KNOWN_LABELS = new Set([...Object.values(LABELS.fr), ...Object.values(LABELS.en)]);

function makeGuild() {
  const sent = [];
  const channel = { id: "CH", isTextBased: () => true, send: async (payload) => { sent.push(payload.embeds[0].toJSON()); return { id: "SENT" }; } };
  return { guild: { id: "G", channels: { cache: new Map([["CH", channel]]) } }, sent };
}

/** Détails représentatifs et non vides pour chaque action. */
function detailsFor(action) {
  const base = {
    who: "Modo (M1)",
    target: "<@U1> `Alice`",
    member: "<@U1> `Alice`",
    channel: "#général (C1)",
    before: "avant",
    after: "après",
    reason: "spam",
    invite: "abc123",
    inviter: "<@I1> `Bob`",
    inviterStats: 7,
    createdAt: "2024-05-01",
    memberCount: 42,
    messageId: "MSG1",
    channelId: "C1",
    memberId: "U1",
    roleId: "R1",
    targetId: "U1",
    moderatorId: "M1",
    userId: "U1",
    ticketChannelId: "T1",
    duration: "10 min",
    count: 3,
    channelType: "Texte",
    parent: "#général (C1)",
    expiresAt: "2026-09-12T10:00:00.000Z",
    uses: 3,
    maxUses: 10,
    rule: "INSULTES",
    rules: ["INSULTES"],
    permissions: "Permissions :\n+ Administrator",
    avatarUrl: "https://cdn.discord/avatars/U1.png",
  };
  // Ne conserver que les clés réellement rendues par l'action.
  const spec = ACTION_FIELDS[action];
  const kept = {};
  for (const [key] of spec) {
    if (key in base) kept[key] = base[key];
  }
  if (base.avatarUrl) kept.avatarUrl = base.avatarUrl;
  return kept;
}

async function render(action, language, details = detailsFor(action)) {
  const { guild, sent } = makeGuild();
  const transport = new DiscordLogsTransport({ guild });
  const config = { language };
  await transport.deliver({
    channelId: "CH",
    guildId: "G",
    language: resolveLanguage(config),
    action,
    title: localizeTitle(config, `logs.${titleKeyOf(action)}`),
    details,
  });
  assert.equal(sent.length, 1, `${action}: un embed envoyé`);
  return sent[0];
}

/** Certaines actions partagent une clé de titre historique. */
function titleKeyOf(action) {
  const aliases = {
    member_joined: "memberJoined",
    member_left: "memberLeft",
    member_nickname_changed: "memberNicknameChanged",
    message_deleted: "messageDeleted",
    message_updated: "messageUpdated",
    messages_bulk_deleted: "messagesBulkDeleted",
  };
  return aliases[action] || action;
}

// ─────────────────────────────────────────────────────────────
// Titres
// ─────────────────────────────────────────────────────────────

test("PHASE1: chaque action possède un titre FR et EN traduit", () => {
  const missing = [];
  for (const action of ACTIONS) {
    const key = titleKeyOf(action);
    if (typeof fr.logs[key] !== "string" || !fr.logs[key].trim()) missing.push(`fr.logs.${key}`);
    if (typeof en.logs[key] !== "string" || !en.logs[key].trim()) missing.push(`en.logs.${key}`);
  }
  assert.deepEqual(missing, [], `clés de titre manquantes : ${missing.join(", ")}`);
});

test("PHASE1: les dictionnaires FR et EN ont exactement les mêmes clés logs", () => {
  assert.deepEqual(Object.keys(fr.logs).sort(), Object.keys(en.logs).sort());
});

test("PHASE1: aucun titre rendu n'est une clé technique", async () => {
  for (const action of ACTIONS) {
    const embedFr = await render(action, "fr");
    const embedEn = await render(action, "en");
    for (const embed of [embedFr, embedEn]) {
      assert.equal(/^logs\./.test(embed.title), false, `${action}: titre brut « ${embed.title} »`);
      assert.notEqual(embed.title, "Log", `${action}: titre de secours utilisé`);
      assert.ok(embed.title.trim().length > 0, `${action}: titre vide`);
    }
  }
});

// ─────────────────────────────────────────────────────────────
// Champs
// ─────────────────────────────────────────────────────────────

test("PHASE1: aucun nom de champ n'est une clé technique", async () => {
  const offenders = [];
  for (const action of ACTIONS) {
    for (const language of ["fr", "en"]) {
      const embed = await render(action, language);
      for (const field of embed.fields) {
        if (!KNOWN_LABELS.has(field.name)) offenders.push(`${action}/${language}: « ${field.name} »`);
      }
    }
  }
  assert.deepEqual(offenders, [], `libellés hors table : ${offenders.join(", ")}`);
});

test("PHASE1: les libellés changent bien avec la langue de la guilde", async () => {
  const checked = [];
  for (const action of ["member_kicked", "message_deleted", "role_updated", "channel_updated", "invite_created"]) {
    const embedFr = await render(action, "fr");
    const embedEn = await render(action, "en");
    const frNames = embedFr.fields.map((field) => field.name);
    const enNames = embedEn.fields.map((field) => field.name);
    assert.notDeepEqual(frNames, enNames, `${action}: les champs doivent être traduits`);
    checked.push(action);
  }
  assert.equal(checked.length, 5);
});

test("PHASE1: les libellés attendus sont présents en FR et en EN", async () => {
  const embedFr = await render("member_kicked", "fr");
  assert.deepEqual(
    embedFr.fields.map((field) => field.name),
    ["👤 Membre", "🆔 ID", "🛡️ Modérateur", "💬 Raison"],
  );

  const embedEn = await render("member_kicked", "en");
  assert.deepEqual(
    embedEn.fields.map((field) => field.name),
    ["👤 Member", "🆔 ID", "🛡️ Moderator", "💬 Reason"],
  );
});

test("PHASE1: les libellés canoniques FR/EN demandés sont exacts", () => {
  const attenduFr = { who: "👤 Qui", channel: "📁 Salon", before: "📝 Avant", after: "✏️ Après", reason: "💬 Raison" };
  const attenduEn = { who: "👤 Who", channel: "📁 Channel", before: "📝 Before", after: "✏️ After", reason: "💬 Reason" };
  for (const [key, value] of Object.entries(attenduFr)) assert.equal(LABELS.fr[key], value, `FR ${key}`);
  for (const [key, value] of Object.entries(attenduEn)) assert.equal(LABELS.en[key], value, `EN ${key}`);
  assert.equal(LABELS.fr.unknown, "inconnu");
  assert.equal(LABELS.en.unknown, "unknown");
});

// ─────────────────────────────────────────────────────────────
// Embeds vides / avatar / couleur
// ─────────────────────────────────────────────────────────────

test("PHASE1: aucun embed vide n'est publié", async () => {
  const { guild, sent } = makeGuild();
  const transport = new DiscordLogsTransport({ guild });

  await assert.rejects(
    () => transport.deliver({ channelId: "CH", language: "fr", action: "member_kicked", title: "Titre", details: {} }),
    /log_embed_empty/,
  );
  await assert.rejects(
    () => transport.deliver({ channelId: "CH", language: "en", action: "captcha_verified", title: "Title", details: {} }),
    /log_embed_empty/,
  );
  assert.equal(sent.length, 0, "rien n'est envoyé dans le salon");
});

test("PHASE1: chaque action rendue porte une couleur de la charte et un thumbnail réel", async () => {
  for (const action of ACTIONS) {
    const embed = await render(action, "fr");
    assert.equal(typeof embed.color, "number", `${action}: couleur absente`);
    if (detailsFor(action).avatarUrl) {
      assert.equal(embed.thumbnail.url, "https://cdn.discord/avatars/U1.png", `${action}: avatar en thumbnail`);
      assert.equal(embed.fields.some((field) => field.name === "avatarUrl"), false, `${action}: l'avatar ne doit pas être un champ`);
    }
  }
});

test("PHASE1: un auteur inconnu est affiché comme tel, jamais inventé", async () => {
  const { guild, sent } = makeGuild();
  const transport = new DiscordLogsTransport({ guild });
  await transport.deliver({ channelId: "CH", language: "fr", action: "x", title: "Titre", details: { who: null, reason: "r" } });
  const who = sent[0].fields.find((field) => field.name === "👤 Qui");
  assert.equal(who.value, "inconnu");
});

// ─────────────────────────────────────────────────────────────
// Tickets et CAPTCHA : même système de rendu
// ─────────────────────────────────────────────────────────────

test("PHASE1: les logs Tickets utilisent le rendu et la traduction partagés", async () => {
  const { createLogsRuntime } = require("../../src/modules/logs/runtime/createLogsRuntime");
  const config = { logs_enabled: true, language: "fr", log_moderation_channel_id: "CH" };
  const runtime = createLogsRuntime({ guildConfigResolver: { get: async () => config } });
  const { guild, sent } = makeGuild();

  await runtime.handleTicketEvent({ guild, config, action: "ticket_created", ticketChannelId: "T1", userId: "U1" });
  assert.equal(sent.length, 1);
  assert.match(sent[0].title, /Ticket créé/);
  assert.equal(/^logs\./.test(sent[0].title), false, "plus de clé brute comme titre");
  for (const field of sent[0].fields) {
    assert.ok(KNOWN_LABELS.has(field.name), `libellé hors table : ${field.name}`);
  }
  assert.equal(sent[0].fields.some((field) => field.name === "action" || field.name === "result"), false);
});

test("PHASE1: les logs CAPTCHA utilisent le rendu et la traduction partagés (module gelé)", async () => {
  const { createLogsRuntime } = require("../../src/modules/logs/runtime/createLogsRuntime");
  const config = { logs_enabled: true, language: "en", log_moderation_channel_id: "CH" };
  const runtime = createLogsRuntime({ guildConfigResolver: { get: async () => config } });
  const { guild, sent } = makeGuild();

  await runtime.handleCaptchaEvent({ guild, config, action: "captcha_verified", memberId: "U1", roleId: "R1" });
  assert.equal(sent.length, 1);
  assert.match(sent[0].title, /CAPTCHA verified/);
  for (const field of sent[0].fields) {
    assert.ok(KNOWN_LABELS.has(field.name), `libellé hors table : ${field.name}`);
  }
  assert.equal(sent[0].fields.some((field) => field.name === "result"), false);
});

test("PHASE1: une guilde inexploitable remonte un motif explicite", async () => {
  const { createLogsRuntime } = require("../../src/modules/logs/runtime/createLogsRuntime");
  const config = { logs_enabled: true, language: "fr", log_moderation_channel_id: "CH" };
  const runtime = createLogsRuntime({ guildConfigResolver: { get: async () => config } });

  const result = await runtime.handleModerationEvent({
    guild: { id: "G" }, // objet partiel, sans channels.cache ni client
    config,
    action: "member_kicked",
    targetId: "U1",
    target: "<@U1>",
    moderator: null,
  });
  assert.equal(result.delivered, false);
  assert.equal(result.reason, "LOG_GUILD_UNAVAILABLE");
});
