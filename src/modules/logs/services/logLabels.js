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

// Mention Discord du membre (`<@id>`) : toujours disponible tant que l'id est
// connu, même pour un membre partiel.
function memberMention(member) {
  if (!member || !member.id) return null;
  return `<@${member.id}>`;
}

// Libellé « membre » : mention + tag si le tag est réellement disponible,
// sinon mention seule, sinon id seul. Jamais de tag inventé.
function memberDisplayLabel(member) {
  if (!member || typeof member !== "object") return null;
  const mention = memberMention(member);
  const tag = member.user && typeof member.user.tag === "string" && member.user.tag
    ? member.user.tag
    : null;
  if (mention && tag) return `${mention} \`${tag}\``;
  if (mention) return mention;
  if (member.id) return String(member.id);
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

// URL d'avatar réelle du membre, ou `null` (aucun fallback inventé).
function avatarUrl(member) {
  if (!member || !member.user || typeof member.user.displayAvatarURL !== "function") return null;
  try {
    return member.user.displayAvatarURL({ extension: "png", size: 256 }) || null;
  } catch {
    return null;
  }
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
};
