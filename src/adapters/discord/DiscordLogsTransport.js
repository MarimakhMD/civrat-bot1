"use strict";

const { EmbedBuilder } = require("discord.js");

const FIELD_LIMITS = Object.freeze({ NAME: 256, VALUE: 1024, MAX_FIELDS: 25 });
const FALLBACK_TITLE = "Log";
const DEFAULT_COLOR = "#5865f2";

// Charte couleur des journaux. `entry.color` (si un appelant le fixe) reste
// prioritaire ; sinon la couleur est dérivée de l'action ; sinon le défaut.
const LOG_COLORS = Object.freeze({
  // vert — création / ajout / arrivée / réussite
  member_joined: "#2ECC71",
  role_created: "#2ECC71",
  channel_created: "#2ECC71",
  thread_created: "#2ECC71",
  member_role_added: "#2ECC71",
  member_unbanned: "#2ECC71",
  member_untimeout: "#2ECC71",
  // rouge — suppression / départ / ban / retrait
  member_left: "#E74C3C",
  message_deleted: "#E74C3C",
  messages_bulk_deleted: "#E74C3C",
  role_deleted: "#E74C3C",
  channel_deleted: "#E74C3C",
  thread_deleted: "#E74C3C",
  member_role_removed: "#E74C3C",
  member_banned: "#E74C3C",
  invite_deleted: "#E74C3C",
  // orange — modification / timeout / kick
  message_updated: "#E67E22",
  member_nickname_changed: "#E67E22",
  role_updated: "#E67E22",
  channel_updated: "#E67E22",
  member_timed_out: "#E67E22",
  member_kicked: "#E67E22",
  // bleu/cyan — invitations / information
  invite_created: "#3498DB",
  invite_used: "#3498DB",
});

// Ordre de rendu des champs canoniques (chemin générique uniquement).
const CANONICAL_FIELDS = Object.freeze([
  ["who", "👤 Qui"],
  ["target", "🎯 Cible"],
  ["channel", "📁 Salon"],
  ["before", "📝 Avant"],
  ["after", "✏️ Après"],
  ["reason", "💬 Raison"],
  ["invite", "🔗 Invitation"],
]);

// Clés d'identifiants regroupées dans un unique champ « 🆔 IDs » (générique).
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

// ─────────────────────────────────────────────────────────────
// Rendus DÉDIÉS par action : ordre et libellés adaptés à l'action.
// Les champs absents ou vides sont omis (jamais inventés) ; `avatarUrl`
// est consommé en thumbnail et n'apparaît jamais comme field.
// ─────────────────────────────────────────────────────────────
const MEMBER_JOIN_FIELDS = Object.freeze([
  ["member", "👤 Membre"],
  ["memberId", "🆔 ID"],
  ["createdAt", "📅 Compte créé"],
  ["invite", "🔗 Invitation utilisée"],
  ["inviter", "🛡️ Invité par"],
  ["inviterStats", "📊 Invitations du recruteur"],
  ["memberCount", "👥 Membres"],
]);

const MEMBER_LEAVE_FIELDS = Object.freeze([
  ["member", "👤 Membre"],
  ["memberId", "🆔 ID"],
  ["createdAt", "📅 Compte créé"],
  ["memberCount", "👥 Membres restants"],
]);

const MESSAGE_DELETED_FIELDS = Object.freeze([
  ["who", "👤 Auteur"],
  ["channel", "📁 Salon"],
  ["before", "🗑️ Contenu supprimé"],
  ["messageId", "🆔 Message"],
  ["channelId", "🆔 Salon"],
]);

const MESSAGE_UPDATED_FIELDS = Object.freeze([
  ["who", "👤 Auteur"],
  ["channel", "📁 Salon"],
  ["before", "📝 Avant"],
  ["after", "✏️ Après"],
  ["messageId", "🆔 Message"],
]);

const MESSAGES_BULK_DELETED_FIELDS = Object.freeze([
  ["channel", "📁 Salon"],
  ["count", "🔢 Nombre de messages"],
  ["before", "📝 Messages supprimés"],
]);

const MEMBER_BANNED_FIELDS = Object.freeze([
  ["target", "👤 Membre"],
  ["targetId", "🆔 ID"],
  ["who", "🛡️ Modérateur"],
  ["reason", "💬 Raison"],
]);

const MEMBER_UNBANNED_FIELDS = Object.freeze([
  ["target", "👤 Membre"],
  ["targetId", "🆔 ID"],
  ["who", "🛡️ Auteur"],
]);

const MEMBER_KICKED_FIELDS = Object.freeze([
  ["target", "👤 Membre"],
  ["targetId", "🆔 ID"],
  ["who", "🛡️ Modérateur"],
  ["reason", "💬 Raison"],
]);

const MEMBER_TIMED_OUT_FIELDS = Object.freeze([
  ["target", "👤 Membre"],
  ["targetId", "🆔 ID"],
  ["duration", "⏱️ Durée"],
  ["who", "🛡️ Modérateur"],
  ["reason", "💬 Raison"],
]);

const MEMBER_UNTIMEOUT_FIELDS = Object.freeze([
  ["target", "👤 Membre"],
  ["targetId", "🆔 ID"],
  ["who", "🛡️ Auteur"],
]);

const ROLE_CREATED_FIELDS = Object.freeze([
  ["target", "🎭 Rôle"],
  ["roleId", "🆔 ID"],
  ["who", "🛡️ Auteur"],
]);

const ROLE_DELETED_FIELDS = Object.freeze([
  ["target", "🎭 Rôle"],
  ["roleId", "🆔 ID"],
  ["who", "🛡️ Auteur"],
]);

const ROLE_UPDATED_FIELDS = Object.freeze([
  ["target", "🎭 Rôle"],
  ["roleId", "🆔 ID"],
  ["before", "📝 Avant"],
  ["after", "✏️ Après"],
  ["who", "🛡️ Auteur"],
]);

const MEMBER_ROLE_ADDED_FIELDS = Object.freeze([
  ["member", "👤 Membre"],
  ["target", "🎭 Rôle ajouté"],
  ["who", "🛡️ Auteur"],
]);

const MEMBER_ROLE_REMOVED_FIELDS = Object.freeze([
  ["member", "👤 Membre"],
  ["target", "🎭 Rôle retiré"],
  ["who", "🛡️ Auteur"],
]);

const CHANNEL_CREATED_FIELDS = Object.freeze([
  ["target", "📁 Salon"],
  ["channelType", "🏷️ Type"],
  ["channelId", "🆔 ID"],
  ["who", "🛡️ Auteur"],
]);

const CHANNEL_DELETED_FIELDS = Object.freeze([
  ["target", "📁 Salon"],
  ["channelType", "🏷️ Type"],
  ["channelId", "🆔 ID"],
  ["who", "🛡️ Auteur"],
]);

const CHANNEL_UPDATED_FIELDS = Object.freeze([
  ["target", "📁 Salon"],
  ["before", "📝 Avant"],
  ["after", "✏️ Après"],
  ["who", "🛡️ Auteur"],
]);

const THREAD_CREATED_FIELDS = Object.freeze([
  ["target", "🧵 Fil"],
  ["parent", "📁 Salon parent"],
  ["channelId", "🆔 ID"],
  ["who", "🛡️ Auteur"],
]);

const THREAD_DELETED_FIELDS = Object.freeze([
  ["target", "🧵 Fil"],
  ["parent", "📁 Salon parent"],
  ["channelId", "🆔 ID"],
  ["who", "🛡️ Auteur"],
]);

const INVITE_CREATED_FIELDS = Object.freeze([
  ["invite", "🔗 Code"],
  ["who", "🛡️ Créateur"],
  ["channel", "📁 Salon"],
  ["expiresAt", "⏳ Expiration"],
  ["uses", "🔢 Utilisations"],
  ["maxUses", "🔢 Utilisations max"],
]);

const INVITE_DELETED_FIELDS = Object.freeze([
  ["invite", "🔗 Code"],
  ["who", "🛡️ Créateur"],
  ["channel", "📁 Salon"],
]);

const INVITE_USED_FIELDS = Object.freeze([
  ["member", "👤 Membre"],
  ["invite", "🔗 Invitation"],
  ["who", "🛡️ Invité par"],
  ["channel", "📁 Salon"],
]);

const MEMBER_NICKNAME_CHANGED_FIELDS = Object.freeze([
  ["member", "👤 Membre"],
  ["before", "📝 Ancien pseudo"],
  ["after", "✏️ Nouveau pseudo"],
  ["who", "🛡️ Auteur"],
]);

const ACTION_FIELDS = Object.freeze({
  member_joined: MEMBER_JOIN_FIELDS,
  member_left: MEMBER_LEAVE_FIELDS,
  message_deleted: MESSAGE_DELETED_FIELDS,
  message_updated: MESSAGE_UPDATED_FIELDS,
  messages_bulk_deleted: MESSAGES_BULK_DELETED_FIELDS,
  member_banned: MEMBER_BANNED_FIELDS,
  member_unbanned: MEMBER_UNBANNED_FIELDS,
  member_kicked: MEMBER_KICKED_FIELDS,
  member_timed_out: MEMBER_TIMED_OUT_FIELDS,
  member_untimeout: MEMBER_UNTIMEOUT_FIELDS,
  role_created: ROLE_CREATED_FIELDS,
  role_deleted: ROLE_DELETED_FIELDS,
  role_updated: ROLE_UPDATED_FIELDS,
  member_role_added: MEMBER_ROLE_ADDED_FIELDS,
  member_role_removed: MEMBER_ROLE_REMOVED_FIELDS,
  channel_created: CHANNEL_CREATED_FIELDS,
  channel_deleted: CHANNEL_DELETED_FIELDS,
  channel_updated: CHANNEL_UPDATED_FIELDS,
  thread_created: THREAD_CREATED_FIELDS,
  thread_deleted: THREAD_DELETED_FIELDS,
  invite_created: INVITE_CREATED_FIELDS,
  invite_deleted: INVITE_DELETED_FIELDS,
  invite_used: INVITE_USED_FIELDS,
  member_nickname_changed: MEMBER_NICKNAME_CHANGED_FIELDS,
});

const CANONICAL_KEYS = new Set(CANONICAL_FIELDS.map(([key]) => key));
const ID_KEYS = new Set(ID_FIELDS.map(([key]) => key));

// Clés qui ne doivent jamais devenir un field : `avatarUrl` sert de thumbnail.
const NON_FIELD_KEYS = new Set(["avatarUrl"]);

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

    embed.setColor(entry.color || LOG_COLORS[entry.action] || DEFAULT_COLOR);

    // Avatar réel du membre concerné, en thumbnail à droite. Jamais de
    // fallback inventé : absent/invalide → aucun thumbnail.
    const thumbnail = normalizeText(entry.details && entry.details.avatarUrl);
    if (thumbnail) embed.setThumbnail(thumbnail);

    // Rendu dédié par action, sinon rendu générique.
    const fields = buildFields(entry);
    if (fields.length > 0) embed.addFields(fields);

    embed.setTimestamp();

    await channel.send({ embeds: [embed] });
  }
}

function buildFields(entry) {
  const details = entry.details;
  if (!details || typeof details !== "object" || Array.isArray(details)) return [];

  const spec = ACTION_FIELDS[entry.action];
  return spec ? buildSpecFields(details, spec) : buildGenericFields(details);
}

function makePusher(fields) {
  return (name, value) => {
    if (fields.length >= FIELD_LIMITS.MAX_FIELDS) return;
    const text = normalizeDetailValue(value);
    if (text === null) return;
    fields.push({
      name: truncate(name, FIELD_LIMITS.NAME),
      value: truncate(text, FIELD_LIMITS.VALUE),
      inline: false,
    });
  };
}

function buildSpecFields(details, spec) {
  const fields = [];
  const push = makePusher(fields);
  for (const [key, label] of spec) {
    if (!Object.prototype.hasOwnProperty.call(details, key)) continue;
    push(label, details[key]);
  }
  return fields;
}

function buildGenericFields(details) {
  const fields = [];
  const push = makePusher(fields);

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

  // 3. Clés restantes (non canoniques, non ID, non thumbnail) : rendu générique.
  for (const [key, value] of Object.entries(details)) {
    if (CANONICAL_KEYS.has(key) || ID_KEYS.has(key) || NON_FIELD_KEYS.has(key)) continue;
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
