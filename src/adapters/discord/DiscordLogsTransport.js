"use strict";

const { EmbedBuilder } = require("discord.js");

const FIELD_LIMITS = Object.freeze({ NAME: 256, VALUE: 1024, MAX_FIELDS: 25 });
const FALLBACK_TITLE = "Log";

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
    // On n'appelle les setters que pour des chaînes réellement non vides.
    const title = normalizeText(entry.title) || FALLBACK_TITLE;
    embed.setTitle(title);

    const description = normalizeText(entry.description);
    if (description) embed.setDescription(description);

    embed.setColor(entry.color || "#5865f2");

    // P1 — rend `entry.details` (jusqu'ici ignoré) en champs d'embed, en
    // filtrant les valeurs nulles/vides et en respectant les limites Discord.
    const fields = buildFields(entry.details);
    if (fields.length > 0) embed.addFields(fields);

    embed.setTimestamp();

    await channel.send({ embeds: [embed] });
  }
}

// Retourne une chaîne nettoyée (trim) non vide, ou null sinon.
function normalizeText(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildFields(details) {
  if (!details || typeof details !== "object" || Array.isArray(details)) return [];
  const fields = [];
  for (const [key, value] of Object.entries(details)) {
    if (fields.length >= FIELD_LIMITS.MAX_FIELDS) break;
    const text = normalizeDetailValue(value);
    if (text === null) continue; // null / undefined / chaîne vide : on n'invente rien.
    fields.push({
      name: truncate(key, FIELD_LIMITS.NAME),
      value: truncate(text, FIELD_LIMITS.VALUE),
      inline: false,
    });
  }
  return fields;
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
