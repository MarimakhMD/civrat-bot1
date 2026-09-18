"use strict";

/**
 * PHASE 1 — rendu des journaux.
 *
 * Trois règles rendues effectives ici :
 *
 *  1. TOUT l'embed respecte la langue de la guilde : titre, libellés de champs
 *     et libellés d'identifiants. Avant, seul le titre était traduit ; les
 *     champs restaient en français (« Qui », « Salon », « Avant », « inconnu »)
 *     quelle que soit la langue configurée.
 *  2. AUCUNE clé technique n'est affichée. Le rendu générique poussait chaque
 *     clé inconnue de `details` comme NOM de champ : `rule`, `rules`, `action`,
 *     `result`, `bot`… se retrouvaient littéralement devant les membres. Les
 *     clés non reconnues sont désormais écartées et signalées au logger.
 *  3. AUCUN embed vide n'est publié. Un log sans titre utile, sans description
 *     et sans champ lève `log_embed_empty` : le défaut devient visible au lieu
 *     d'arriver dans le salon.
 */

const { EmbedBuilder } = require("discord.js");

const FIELD_LIMITS = Object.freeze({ NAME: 256, VALUE: 1024, MAX_FIELDS: 25 });
const DEFAULT_COLOR = "#5865f2";

// ─────────────────────────────────────────────────────────────
// Libellés localisés
// ─────────────────────────────────────────────────────────────

const LABELS = Object.freeze({
  fr: Object.freeze({
    // Canoniques
    who: "👤 Qui",
    target: "🎯 Cible",
    channel: "📁 Salon",
    before: "📝 Avant",
    after: "✏️ Après",
    reason: "💬 Raison",
    invite: "🔗 Invitation",
    permissions: "🔐 Permissions",
    rule: "📏 Règle",
    rules: "📏 Règles",
    count: "🔢 Quantité",
    unknown: "inconnu",
    ids: "🆔 IDs",
    // Sous-libellés du champ « IDs »
    idMessage: "message",
    idChannel: "salon",
    idMember: "membre",
    idRole: "rôle",
    idTarget: "cible",
    idModerator: "modérateur",
    idAuthor: "auteur",
    idUser: "utilisateur",
    idTicket: "ticket",
    // Rendus dédiés
    member: "👤 Membre",
    id: "🆔 ID",
    createdAt: "📅 Compte créé",
    inviteUsed: "🔗 Invitation utilisée",
    invitedBy: "🛡️ Invité par",
    inviterStats: "📊 Invitations du recruteur",
    memberCount: "👥 Membres",
    memberCountLeft: "👥 Membres restants",
    author: "👤 Auteur",
    deletedContent: "🗑️ Contenu supprimé",
    messageId: "🆔 Message",
    channelId: "🆔 Salon",
    messageCount: "🔢 Nombre de messages",
    deletedMessages: "📝 Messages supprimés",
    moderator: "🛡️ Modérateur",
    duration: "⏱️ Durée",
    role: "🎭 Rôle",
    roleAdded: "🎭 Rôle ajouté",
    roleRemoved: "🎭 Rôle retiré",
    channelField: "📁 Salon",
    channelType: "🏷️ Type",
    parentChannel: "📁 Salon parent",
    inviteCode: "🔗 Code",
    creator: "🛡️ Créateur",
    expiresAt: "⏳ Expiration",
    uses: "🔢 Utilisations",
    maxUses: "🔢 Utilisations max",
    previousNickname: "📝 Ancien pseudo",
    newNickname: "✏️ Nouveau pseudo",
    actor: "🛡️ Auteur",
    ticket: "🎫 Ticket",
    thread: "🧵 Fil",
  }),
  en: Object.freeze({
    who: "👤 Who",
    target: "🎯 Target",
    channel: "📁 Channel",
    before: "📝 Before",
    after: "✏️ After",
    reason: "💬 Reason",
    invite: "🔗 Invite",
    permissions: "🔐 Permissions",
    rule: "📏 Rule",
    rules: "📏 Rules",
    count: "🔢 Count",
    unknown: "unknown",
    ids: "🆔 IDs",
    idMessage: "message",
    idChannel: "channel",
    idMember: "member",
    idRole: "role",
    idTarget: "target",
    idModerator: "moderator",
    idAuthor: "author",
    idUser: "user",
    idTicket: "ticket",
    member: "👤 Member",
    id: "🆔 ID",
    createdAt: "📅 Account created",
    inviteUsed: "🔗 Invite used",
    invitedBy: "🛡️ Invited by",
    inviterStats: "📊 Inviter's invites",
    memberCount: "👥 Members",
    memberCountLeft: "👥 Members left",
    author: "👤 Author",
    deletedContent: "🗑️ Deleted content",
    messageId: "🆔 Message",
    channelId: "🆔 Channel",
    messageCount: "🔢 Message count",
    deletedMessages: "📝 Deleted messages",
    moderator: "🛡️ Moderator",
    duration: "⏱️ Duration",
    role: "🎭 Role",
    roleAdded: "🎭 Role added",
    roleRemoved: "🎭 Role removed",
    channelField: "📁 Channel",
    channelType: "🏷️ Type",
    parentChannel: "📁 Parent channel",
    inviteCode: "🔗 Code",
    creator: "🛡️ Creator",
    expiresAt: "⏳ Expires",
    uses: "🔢 Uses",
    maxUses: "🔢 Max uses",
    previousNickname: "📝 Previous nickname",
    newNickname: "✏️ New nickname",
    actor: "🛡️ Author",
    ticket: "🎫 Ticket",
    thread: "🧵 Thread",
  }),
});

function languageOf(entry) {
  return entry && entry.language === "en" ? "en" : "fr";
}

function labelFor(labelId, language) {
  const table = LABELS[language] || LABELS.fr;
  return table[labelId] || LABELS.fr[labelId] || labelId;
}

/** Titre de secours quand aucune traduction n'existe : un mot, jamais une clé. */
function fallbackTitle(language) {
  return language === "en" ? "Log" : "Log";
}

// ─────────────────────────────────────────────────────────────
// Charte couleur des journaux
// ─────────────────────────────────────────────────────────────

const LOG_COLORS = Object.freeze({
  // vert — création / ajout / arrivée / réussite
  member_joined: "#2ECC71",
  role_created: "#2ECC71",
  channel_created: "#2ECC71",
  thread_created: "#2ECC71",
  member_role_added: "#2ECC71",
  member_unbanned: "#2ECC71",
  member_untimeout: "#2ECC71",
  ticket_created: "#2ECC71",
  ticket_member_added: "#2ECC71",
  captcha_verified: "#2ECC71",
  // rouge — suppression / départ / ban / retrait / alerte
  member_left: "#E74C3C",
  message_deleted: "#E74C3C",
  messages_bulk_deleted: "#E74C3C",
  role_deleted: "#E74C3C",
  channel_deleted: "#E74C3C",
  thread_deleted: "#E74C3C",
  member_role_removed: "#E74C3C",
  member_banned: "#E74C3C",
  invite_deleted: "#E74C3C",
  ticket_deleted: "#E74C3C",
  ticket_member_removed: "#E74C3C",
  ticket_creation_rolled_back: "#E74C3C",
  ticket_creation_orphan: "#E74C3C",
  captcha_verification_failed: "#E74C3C",
  security_raid: "#C0392B",
  security_bot: "#C0392B",
  security_nuke: "#C0392B",
  // orange — modification / timeout / kick / avertissement
  message_updated: "#E67E22",
  member_nickname_changed: "#E67E22",
  role_updated: "#E67E22",
  channel_updated: "#E67E22",
  member_timed_out: "#E67E22",
  member_kicked: "#E67E22",
  automod: "#E67E22",
  warn: "#E67E22",
  ticket_closed: "#E67E22",
  ticket_renamed: "#E67E22",
  // bleu/cyan — invitations / information
  invite_created: "#3498DB",
  invite_used: "#3498DB",
  ticket_reopened: "#3498DB",
  ticket_claimed: "#3498DB",
});

// ─────────────────────────────────────────────────────────────
// Rendu générique : champs canoniques + identifiants
// ─────────────────────────────────────────────────────────────

const CANONICAL_FIELDS = Object.freeze([
  ["who", "who"],
  ["target", "target"],
  ["channel", "channel"],
  ["before", "before"],
  ["after", "after"],
  ["reason", "reason"],
  ["invite", "invite"],
  ["rule", "rule"],
  ["rules", "rules"],
  ["count", "count"],
]);

const ID_FIELDS = Object.freeze([
  ["messageId", "idMessage"],
  ["channelId", "idChannel"],
  ["memberId", "idMember"],
  ["roleId", "idRole"],
  ["targetId", "idTarget"],
  ["moderatorId", "idModerator"],
  ["authorId", "idAuthor"],
  ["userId", "idUser"],
  ["ticketChannelId", "idTicket"],
]);

// ─────────────────────────────────────────────────────────────
// Rendus DÉDIÉS par action : ordre et libellés adaptés à l'action.
// Les champs absents ou vides sont omis (jamais inventés) ; `avatarUrl`
// est consommé en thumbnail et n'apparaît jamais comme field.
// ─────────────────────────────────────────────────────────────

const MEMBER_JOIN_FIELDS = Object.freeze([
  ["member", "member"],
  ["memberId", "id"],
  ["createdAt", "createdAt"],
  ["invite", "inviteUsed"],
  ["inviter", "invitedBy"],
  ["inviterStats", "inviterStats"],
  ["memberCount", "memberCount"],
]);

const MEMBER_LEAVE_FIELDS = Object.freeze([
  ["member", "member"],
  ["memberId", "id"],
  ["createdAt", "createdAt"],
  ["memberCount", "memberCountLeft"],
]);

const MESSAGE_DELETED_FIELDS = Object.freeze([
  ["who", "author"],
  ["channel", "channel"],
  ["before", "deletedContent"],
  ["messageId", "messageId"],
  ["channelId", "channelId"],
]);

const MESSAGE_UPDATED_FIELDS = Object.freeze([
  ["who", "author"],
  ["channel", "channel"],
  ["before", "before"],
  ["after", "after"],
  ["messageId", "messageId"],
]);

const MESSAGES_BULK_DELETED_FIELDS = Object.freeze([
  ["channel", "channel"],
  ["count", "messageCount"],
  ["before", "deletedMessages"],
]);

const MEMBER_BANNED_FIELDS = Object.freeze([
  ["target", "member"],
  ["targetId", "id"],
  ["who", "moderator"],
  ["reason", "reason"],
]);

const MEMBER_UNBANNED_FIELDS = Object.freeze([
  ["target", "member"],
  ["targetId", "id"],
  ["who", "actor"],
]);

const MEMBER_KICKED_FIELDS = Object.freeze([
  ["target", "member"],
  ["targetId", "id"],
  ["who", "moderator"],
  ["reason", "reason"],
]);

const MEMBER_TIMED_OUT_FIELDS = Object.freeze([
  ["target", "member"],
  ["targetId", "id"],
  ["duration", "duration"],
  ["who", "moderator"],
  ["reason", "reason"],
]);

const MEMBER_UNTIMEOUT_FIELDS = Object.freeze([
  ["target", "member"],
  ["targetId", "id"],
  ["who", "actor"],
]);

const WARN_FIELDS = Object.freeze([
  ["target", "member"],
  ["targetId", "id"],
  ["who", "moderator"],
  ["reason", "reason"],
]);

const ROLE_CREATED_FIELDS = Object.freeze([
  ["target", "role"],
  ["roleId", "id"],
  ["who", "actor"],
]);

const ROLE_DELETED_FIELDS = Object.freeze([
  ["target", "role"],
  ["roleId", "id"],
  ["who", "actor"],
]);

const ROLE_UPDATED_FIELDS = Object.freeze([
  ["target", "role"],
  ["roleId", "id"],
  ["before", "before"],
  ["after", "after"],
  ["permissions", "permissions"],
  ["who", "actor"],
]);

const MEMBER_ROLE_ADDED_FIELDS = Object.freeze([
  ["member", "member"],
  ["target", "roleAdded"],
  ["who", "actor"],
]);

const MEMBER_ROLE_REMOVED_FIELDS = Object.freeze([
  ["member", "member"],
  ["target", "roleRemoved"],
  ["who", "actor"],
]);

const CHANNEL_CREATED_FIELDS = Object.freeze([
  ["target", "channelField"],
  ["channelType", "channelType"],
  ["channelId", "id"],
  ["who", "actor"],
]);

const CHANNEL_DELETED_FIELDS = Object.freeze([
  ["target", "channelField"],
  ["channelType", "channelType"],
  ["channelId", "id"],
  ["who", "actor"],
]);

const CHANNEL_UPDATED_FIELDS = Object.freeze([
  ["target", "channelField"],
  ["before", "before"],
  ["after", "after"],
  ["permissions", "permissions"],
  ["who", "actor"],
]);

const THREAD_CREATED_FIELDS = Object.freeze([
  ["target", "thread"],
  ["parent", "parentChannel"],
  ["channelId", "id"],
  ["who", "actor"],
]);

const THREAD_DELETED_FIELDS = Object.freeze([
  ["target", "thread"],
  ["parent", "parentChannel"],
  ["channelId", "id"],
  ["who", "actor"],
]);

const INVITE_CREATED_FIELDS = Object.freeze([
  ["invite", "inviteCode"],
  ["who", "creator"],
  ["channel", "channel"],
  ["expiresAt", "expiresAt"],
  ["uses", "uses"],
  ["maxUses", "maxUses"],
]);

const INVITE_DELETED_FIELDS = Object.freeze([
  ["invite", "inviteCode"],
  ["who", "creator"],
  ["channel", "channel"],
]);

const INVITE_USED_FIELDS = Object.freeze([
  ["member", "member"],
  ["invite", "invite"],
  ["who", "invitedBy"],
  ["channel", "channel"],
]);

const MEMBER_NICKNAME_CHANGED_FIELDS = Object.freeze([
  ["member", "member"],
  ["before", "previousNickname"],
  ["after", "newNickname"],
  ["who", "actor"],
]);

const AUTOMOD_FIELDS = Object.freeze([
  ["target", "member"],
  ["targetId", "id"],
  ["duration", "duration"],
  ["rule", "rule"],
  ["rules", "rules"],
  ["reason", "reason"],
]);

const SECURITY_RAID_FIELDS = Object.freeze([
  ["target", "member"],
  ["targetId", "id"],
  ["reason", "reason"],
  ["rule", "rule"],
]);

const SECURITY_BOT_FIELDS = Object.freeze([
  ["target", "member"],
  ["targetId", "id"],
  ["reason", "reason"],
  ["rule", "rule"],
]);

const SECURITY_NUKE_FIELDS = Object.freeze([
  ["reason", "reason"],
  ["rule", "rule"],
]);

const TICKET_FIELDS = Object.freeze([
  ["ticketChannelId", "ticket"],
  ["userId", "idUser"],
  ["reason", "reason"],
]);

const CAPTCHA_FIELDS = Object.freeze([
  ["memberId", "idMember"],
  ["roleId", "idRole"],
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
  warn: WARN_FIELDS,
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
  automod: AUTOMOD_FIELDS,
  security_raid: SECURITY_RAID_FIELDS,
  security_bot: SECURITY_BOT_FIELDS,
  security_nuke: SECURITY_NUKE_FIELDS,
  ticket_created: TICKET_FIELDS,
  ticket_closed: TICKET_FIELDS,
  ticket_reopened: TICKET_FIELDS,
  ticket_deleted: TICKET_FIELDS,
  ticket_renamed: TICKET_FIELDS,
  ticket_member_added: TICKET_FIELDS,
  ticket_member_removed: TICKET_FIELDS,
  ticket_claimed: TICKET_FIELDS,
  ticket_creation_rolled_back: TICKET_FIELDS,
  ticket_creation_orphan: TICKET_FIELDS,
  captcha_verified: CAPTCHA_FIELDS,
  captcha_verification_failed: CAPTCHA_FIELDS,
});

const CANONICAL_KEYS = new Set(CANONICAL_FIELDS.map(([key]) => key));
const ID_KEYS = new Set(ID_FIELDS.map(([key]) => key));

// Clés qui ne doivent jamais devenir un field : `avatarUrl` sert de thumbnail.
const NON_FIELD_KEYS = new Set(["avatarUrl"]);

class DiscordLogsTransport {
  constructor({ guild, logger = null }) {
    this.guild = guild;
    this.logger = logger;
  }

  async deliver(entry) {
    // PHASE 1 — une guilde inexploitable (appelant passant `{ id }`) était
    // auparavant un TypeError ravalé en erreur de transport illisible.
    if (!this.guild || !this.guild.channels || !this.guild.channels.cache) {
      throw new Error("log_guild_unavailable");
    }

    const channel = this.guild.channels.cache.get(entry.channelId);
    if (!channel?.isTextBased()) throw new Error("log_channel_unavailable");

    const language = languageOf(entry);
    const embed = new EmbedBuilder();

    // P0 — jamais de chaîne vide : discord.js valide `title` (1..256) et
    // `description` (1..4096) et lève une CombinedError sur une chaîne vide.
    const title = normalizeText(entry.title) || fallbackTitle(language);
    embed.setTitle(title);

    const description = normalizeText(entry.description);
    if (description) embed.setDescription(description);

    embed.setColor(entry.color || LOG_COLORS[entry.action] || DEFAULT_COLOR);

    // Avatar réel du membre concerné, en thumbnail à droite. Jamais de
    // fallback inventé : absent/invalide → aucun thumbnail.
    const thumbnail = normalizeText(entry.details && entry.details.avatarUrl);
    if (thumbnail) embed.setThumbnail(thumbnail);

    // Rendu dédié par action, sinon rendu générique.
    const fields = buildFields(entry, language);
    if (fields.length > 0) embed.addFields(fields);

    // PHASE 1 — aucun embed vide n'est publié. Un log sans champ, sans
    // description et sans thumbnail n'apporte rien au membre : on préfère
    // le signaler (observabilité) plutôt que de polluer le salon.
    if (fields.length === 0 && !description && !thumbnail) {
      throw new Error("log_embed_empty");
    }

    embed.setTimestamp();

    await channel.send({ embeds: [embed] });
  }
}

function buildFields(entry, language) {
  const details = entry.details;
  if (!details || typeof details !== "object" || Array.isArray(details)) return [];

  const spec = ACTION_FIELDS[entry.action];
  return spec ? buildSpecFields(details, spec, language) : buildGenericFields(details, language);
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

function buildSpecFields(details, spec, language) {
  const fields = [];
  const push = makePusher(fields);
  for (const [key, labelId] of spec) {
    if (!Object.prototype.hasOwnProperty.call(details, key)) continue;
    push(labelFor(labelId, language), details[key]);
  }
  return fields;
}

function buildGenericFields(details, language) {
  const fields = [];
  const push = makePusher(fields);

  // 1. Champs canoniques, dans l'ordre. `who` absent → champ omis ;
  //    `who` présent mais vide/null → « inconnu » (jamais d'identité inventée).
  for (const [key, labelId] of CANONICAL_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(details, key)) continue;
    const value = normalizeDetailValue(details[key]);
    if (key === "who") {
      push(labelFor(labelId, language), value === null ? labelFor("unknown", language) : value);
    } else {
      push(labelFor(labelId, language), value);
    }
  }

  // 2. Identifiants regroupés en un unique champ multi-lignes.
  const idLines = [];
  for (const [key, labelId] of ID_FIELDS) {
    const value = normalizeDetailValue(details[key]);
    if (value !== null) idLines.push(`${labelFor(labelId, language)}: ${value}`);
  }
  if (idLines.length > 0) push(labelFor("ids", language), idLines.join("\n"));

  return fields;
}

/**
 * Clés de `details` qu'aucun rendu ne sait afficher.
 *
 * Retour à des fins de diagnostic : les publier telles quelles exposerait des
 * noms techniques (`result`, `action`, `bot`…) aux membres. Le transport les
 * écarte ; l'appelant est responsable de les mapper vers un libellé.
 */
function unrecognizedDetailKeys(entry) {
  const details = entry && entry.details;
  if (!details || typeof details !== "object" || Array.isArray(details)) return [];

  const spec = ACTION_FIELDS[entry.action];
  const known = new Set([
    ...CANONICAL_KEYS,
    ...ID_KEYS,
    ...NON_FIELD_KEYS,
    ...(spec ? spec.map(([key]) => key) : []),
  ]);

  return Object.keys(details).filter((key) => !known.has(key));
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
  const text = Array.isArray(value) ? value.join(", ") : String(value);
  return text.length > 0 ? text : null;
}

function truncate(text, max) {
  return text.length > max ? text.slice(0, max) : text;
}

module.exports = { DiscordLogsTransport, unrecognizedDetailKeys, ACTION_FIELDS, LOG_COLORS, LABELS, labelFor };
