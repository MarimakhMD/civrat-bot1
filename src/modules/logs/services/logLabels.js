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

module.exports = { UNKNOWN, userLabel, memberLabel, channelLabel, roleLabel, executorLabel };
