"use strict";

const { EmbedBuilder } = require("discord.js");

const FIELD_LIMITS = Object.freeze({ NAME: 256, VALUE: 1024, MAX_FIELDS: 25 });
const FALLBACK_TITLE = "Log";

// Ordre de rendu des champs canoniques. Le transport mappe les clés
// sémantiques de `details` vers des libellés uniformes, dans cet ordre.
const CANONICAL_FIELDS = Object.freeze([
  ["who", "👤 Qui"],
  ["target", "🎯 Cible"],
  ["channel", "📁 Salon"],
  ["before", "📝 Avant"],
  ["after", "✏️ Après"],
  ["reason", "💬 Raison"],
  ["invite", "🔗 Invitation"],
]);

// Clés d'identifiants regroupées dans un unique champ « 🆔 IDs ».
const ID_FIELDS = Object.freeze([
  ["messageId", "message"],
  ["channelId", "salon"],
  ["memberId", "membre"],
  ["roleId", "rôle"],
  ["targetId", "cible"],
  ["moderatorId", "modérateur"],
  ["authorId", "auteur"],
  ["userId", "utilisateur"],
]);

const CANONICAL_KEYS = new Set(CANONICAL_FIELDS.map(([key]) => key));
const ID_KEYS = new Set(ID_FIELDS.map(([key]) => key));

class DiscordLogsTransport {
  constructor({ guild }) {
    this.guild = guild;
  }

  async deliver(entry) {
    const channel = this.guild.channels.cache.get(entry.channelId);
    if (!channel?.isTextBased()) throw new Error("log_channel_unavailable");

    const embed = new EmbedBuilder();

    // P0 — jamais de chaîne vide : discord.js valide `title` (1..256) et
    // `description` (1..4096) et lève un CombinedError sur une chaîne vide.
    const title = normalizeText(entry.title) || FALLBACK_TITLE;
    embed.setTitle(title);

    const description = normalizeText(entry.description);
    if (description) embed.setDescription(description);

    embed.setColor(entry.color || "#5865f2");

    // P1c — rendu uniforme de `entry.details`.
    const fields = buildFields(entry.details);
    if (fields.length > 0) embed.addFields(fields);

    embed.setTimestamp();

    await channel.send({ embeds: [embed] });
  }
}

function buildFields(details) {
  if (!details || typeof details !== "object" || Array.isArray(details)) return [];

  const fields = [];
  const push = (name, value) => {
    if (fields.length >= FIELD_LIMITS.MAX_FIELDS) return;
    const text = normalizeDetailValue(value);
    if (text === null) return;
    fields.push({
      name: truncate(name, FIELD_LIMITS.NAME),
      value: truncate(text, FIELD_LIMITS.VALUE),
      inline: false,
    });
  };

  // 1. Champs canoniques, dans l'ordre. `who` absent → champ omis ;
  //    `who` présent mais vide/null → « inconnu » (jamais d'identité inventée).
  for (const [key, label] of CANONICAL_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(details, key)) continue;
    const value = normalizeDetailValue(details[key]);
    if (key === "who") {
      push(label, value === null ? "inconnu" : value);
    } else {
      push(label, value);
    }
  }

  // 2. Identifiants regroupés en un unique champ multi-lignes.
  const idLines = [];
  for (const [key, label] of ID_FIELDS) {
    const value = normalizeDetailValue(details[key]);
    if (value !== null) idLines.push(`${label}: ${value}`);
  }
  if (idLines.length > 0) push("🆔 IDs", idLines.join("\n"));

  // 3. Clés restantes (non canoniques, non ID) : rendu générique clé → valeur.
  for (const [key, value] of Object.entries(details)) {
    if (CANONICAL_KEYS.has(key) || ID_KEYS.has(key)) continue;
    push(key, value);
  }

  return fields;
}

// Retourne une chaîne nettoyée (trim) non vide, ou null sinon.
function normalizeText(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeDetailValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  // Nombres, booléens, tableaux, objets : conversion explicite, jamais de vide.
  const text = String(value);
  return text.length > 0 ? text : null;
}

function truncate(text, max) {
  return text.length > max ? text.slice(0, max) : text;
}

module.exports = { DiscordLogsTransport };
