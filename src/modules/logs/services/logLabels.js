"use strict";

// Helpers de formatage des libellés des journaux.
//
// Règle absolue : aucune donnée n'est inventée. Chaque fonction retourne
// `null` quand l'information est absente, et le transport affiche alors
// « inconnu » (pour `who`) ou omet le champ (pour les autres), sans jamais
// produire une identité ou une valeur fabriquée.

const UNKNOWN = "inconnu";

function userLabel(user) {
  if (!user || typeof user !== "object") return null;
  if (typeof user.tag === "string" && user.tag) {
    return user.id ? `${user.tag} (${user.id})` : user.tag;
  }
  if (user.id) return String(user.id);
  return null;
}

function memberLabel(member) {
  if (!member || typeof member !== "object") return null;
  if (member.user && typeof member.user.tag === "string" && member.user.tag) {
    return member.id ? `${member.user.tag} (${member.id})` : member.user.tag;
  }
  if (member.id) return String(member.id);
  return null;
}

function channelLabel(channel) {
  if (!channel || typeof channel !== "object") return null;
  const name = typeof channel.name === "string" && channel.name ? `#${channel.name}` : "";
  const id = channel.id ? ` (${channel.id})` : "";
  const label = `${name}${id}`.trim();
  return label.length > 0 ? label : null;
}

function roleLabel(role) {
  if (!role || typeof role !== "object") return null;
  const name = typeof role.name === "string" && role.name ? `@${role.name}` : "";
  const id = role.id ? ` (${role.id})` : "";
  const label = `${name}${id}`.trim();
  return label.length > 0 ? label : null;
}

// Résout le libellé de l'exécutant d'une entrée d'audit, sans deviner :
// `null` si l'entrée est absente ou sans exécutant fiable.
function executorLabel(entry) {
  if (!entry || typeof entry !== "object") return null;
  return userLabel(entry.executor);
}

// Mention Discord (`<@id>`) : toujours disponible tant que l'id est connu,
// même pour un membre partiel.
function memberMention(subject) {
  const id = subject && (subject.id || (subject.user && subject.user.id));
  if (!id) return null;
  return `<@${id}>`;
}

// Libellé « membre » : mention + tag si le tag est réellement disponible,
// sinon mention seule, sinon id seul. Jamais de tag inventé. Accepte un
// GuildMember (`{ user }`) comme un User (tag direct).
function memberDisplayLabel(subject) {
  if (!subject || typeof subject !== "object") return null;
  const user = subject.user && typeof subject.user === "object" ? subject.user : subject;
  const id = subject.id || user.id;
  const mention = id ? `<@${id}>` : null;
  const tag = typeof user.tag === "string" && user.tag ? user.tag : null;
  if (mention && tag) return `${mention} \`${tag}\``;
  if (mention) return mention;
  if (id) return String(id);
  return null;
}

// Date de création du compte Discord au format ISO (AAAA-MM-JJ), ou `null` si
// indisponible (utilisateur absent sur un membre partiel).
function accountCreatedAt(member) {
  const createdAt = member && member.user && member.user.createdAt;
  if (!createdAt) return null;
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

// URL d'avatar réelle, ou `null` (aucun fallback inventé). Accepte un
// GuildMember (`{ user }`) comme un User (displayAvatarURL direct).
function avatarUrl(subject) {
  if (!subject || typeof subject !== "object") return null;
  const user = subject.user && typeof subject.user === "object" ? subject.user : subject;
  if (!user || typeof user.displayAvatarURL !== "function") return null;
  try {
    return user.displayAvatarURL({ extension: "png", size: 256 }) || null;
  } catch {
    return null;
  }
}

// Libellé de l'inviteur (`<@id>` + tag si résolu depuis les caches), sinon
// mention seule. Jamais d'identité inventée.
function inviterDisplayLabel(member, inviterId) {
  if (!inviterId) return null;
  const mention = `<@${inviterId}>`;
  const cached = resolveCachedUser(member, inviterId);
  const tag = cached && typeof cached.tag === "string" && cached.tag ? cached.tag : null;
  return tag ? `${mention} \`${tag}\`` : mention;
}

function resolveCachedUser(member, inviterId) {
  const guild = member && member.guild;
  const fromMembers = guild && guild.members && guild.members.cache && guild.members.cache.get(inviterId);
  if (fromMembers) return fromMembers.user || fromMembers;
  const fromUsers = guild && guild.client && guild.client.users && guild.client.users.cache && guild.client.users.cache.get(inviterId);
  return fromUsers || null;
}

// Type de salon lisible (`null` si inconnu). Couvre les salons classiques et
// les fils (public/privé).
const CHANNEL_TYPE_LABELS = Object.freeze({
  0: "Texte",
  2: "Vocal",
  4: "Catégorie",
  5: "Annonce",
  13: "Scène",
  15: "Forum",
  11: "Fil public",
  12: "Fil privé",
});

function channelTypeLabel(channel) {
  if (!channel || channel.type === undefined || channel.type === null) return null;
  return CHANNEL_TYPE_LABELS[channel.type] || null;
}

// Durée lisible (`null` si non calculable). Ex. « 45 min », « 2 h 15 min ».
function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remMin = minutes % 60;
  if (hours < 24) return remMin ? `${hours} h ${remMin} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  const remH = hours % 24;
  return remH ? `${days} j ${remH} h` : `${days} j`;
}

module.exports = {
  UNKNOWN,
  userLabel,
  memberLabel,
  channelLabel,
  roleLabel,
  executorLabel,
  memberMention,
  memberDisplayLabel,
  accountCreatedAt,
  avatarUrl,
  inviterDisplayLabel,
  resolveCachedUser,
  channelTypeLabel,
  formatDuration,
};
