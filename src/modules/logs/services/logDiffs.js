"use strict";

/**
 * PHASE 1 — détection des changements RÉELS sur un rôle ou un salon.
 *
 * Avant cette phase, `roleUpdate` et `channelUpdate` ne comparaient que le NOM :
 * un changement de couleur, de permissions, de slowmode ou de catégorie ne
 * produisait aucun log, et un renommage produisait un log même si rien d'autre
 * n'avait bougé.
 *
 * Règle : on ne génère que les changements réellement détectés. Une propriété
 * absente ou illisible sur l'un des deux objets n'est JAMAIS devinée — elle est
 * simplement exclue de la comparaison.
 */

const { channelLabel } = require("./logLabels");

// ─────────────────────────────────────────────────────────────
// Libellés localisés des propriétés comparées
// ─────────────────────────────────────────────────────────────

const CHANGE_LABELS = Object.freeze({
  fr: Object.freeze({
    name: "Nom",
    color: "Couleur",
    hoist: "Affiché séparément",
    mentionable: "Mentionnable",
    permissions: "Permissions",
    topic: "Description",
    position: "Position",
    slowmode: "Slowmode",
    nsfw: "NSFW",
    parent: "Catégorie",
    bitrate: "Débit audio",
    userLimit: "Limite d'utilisateurs",
    yes: "Oui",
    no: "Non",
    none: "Aucun",
  }),
  en: Object.freeze({
    name: "Name",
    color: "Color",
    hoist: "Displayed separately",
    mentionable: "Mentionable",
    permissions: "Permissions",
    topic: "Topic",
    position: "Position",
    slowmode: "Slowmode",
    nsfw: "NSFW",
    parent: "Category",
    bitrate: "Bitrate",
    userLimit: "User limit",
    yes: "Yes",
    no: "No",
    none: "None",
  }),
});

function language(config) {
  return config && config.language === "en" ? "en" : "fr";
}

/** Libellé localisé d'une propriété comparée. */
function changeLabel(key, config) {
  return CHANGE_LABELS[language(config)][key] || key;
}

/** Oui / Non localisé. */
function booleanLabel(value, config) {
  return value ? CHANGE_LABELS[language(config)].yes : CHANGE_LABELS[language(config)].no;
}

// ─────────────────────────────────────────────────────────────
// Normalisations défensives
// ─────────────────────────────────────────────────────────────

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Texte pouvant être explicitement vidé.
 *
 * `null` sur un topic Discord signifie « aucun topic » — c'est une valeur
 * déterminée, pas une inconnue : vider un topic est donc un changement réel.
 * `undefined` (propriété absente) reste non comparable et exclut le diff.
 */
function nullableText(value) {
  if (typeof value === "string") return value.trim();
  if (value === null) return "";
  return null;
}

function number(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function boolean(value) {
  return typeof value === "boolean" ? value : null;
}

/** `#RRGGBB` depuis un rôle, ou `null` si la couleur n'est pas déterminable. */
function hexColor(role) {
  if (!role) return null;
  if (typeof role.hexColor === "string" && /^#[0-9a-f]{6}$/i.test(role.hexColor)) return role.hexColor.toLowerCase();
  const raw = number(role.color);
  if (raw === null) return null;
  return `#${raw.toString(16).padStart(6, "0")}`;
}

/** Noms de permissions triés, ou `null` si l'objet ne les expose pas. */
function permissionNames(bitfield) {
  if (!bitfield || typeof bitfield.toArray !== "function") return null;
  try {
    const names = bitfield.toArray();
    if (!Array.isArray(names)) return null;
    return [...names].sort();
  } catch {
    return null;
  }
}

/**
 * Signature stable des surcharges de permissions d'un salon, ou `null`.
 * `null` signifie « non comparable » : la propriété est alors exclue du diff.
 */
function overwriteSignature(channel) {
  const cache = channel && channel.permissionOverwrites && channel.permissionOverwrites.cache;
  if (!cache || typeof cache.forEach !== "function") return null;

  const lines = [];
  try {
    cache.forEach((overwrite, id) => {
      const allow = permissionNames(overwrite && overwrite.allow) || [];
      const deny = permissionNames(overwrite && overwrite.deny) || [];
      lines.push(`${id} +[${allow.join(",")}] -[${deny.join(",")}]`);
    });
  } catch {
    return null;
  }
  return lines.sort().join("\n");
}

/** Diff lisible de deux listes de permissions : `+ Ajoutées` / `− Retirées`. */
function permissionDiff(before, after) {
  if (before === null || after === null) return null;
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  const added = after.filter((name) => !beforeSet.has(name));
  const removed = before.filter((name) => !afterSet.has(name));
  if (added.length === 0 && removed.length === 0) return null;
  const parts = [];
  if (added.length > 0) parts.push(`+ ${added.join(", ")}`);
  if (removed.length > 0) parts.push(`− ${removed.join(", ")}`);
  return parts.join("\n");
}

// ─────────────────────────────────────────────────────────────
// Détection
// ─────────────────────────────────────────────────────────────

/** Ajoute un changement seulement si les DEUX valeurs sont comparables. */
function push(changes, key, before, after) {
  if (before === null || before === undefined) return;
  if (after === null || after === undefined) return;
  if (before === after) return;
  changes.push({ key, before, after });
}

/**
 * Changements réels entre deux états d'un rôle.
 * @returns {Array<{key:string,before:*,after:*}>}
 */
function roleChanges(oldRole, newRole) {
  const changes = [];
  if (!oldRole || !newRole) return changes;

  push(changes, "name", text(oldRole.name), text(newRole.name));
  push(changes, "color", hexColor(oldRole), hexColor(newRole));
  push(changes, "hoist", boolean(oldRole.hoist), boolean(newRole.hoist));
  push(changes, "mentionable", boolean(oldRole.mentionable), boolean(newRole.mentionable));

  const permissionsBefore = permissionNames(oldRole.permissions);
  const permissionsAfter = permissionNames(newRole.permissions);
  if (permissionsBefore && permissionsAfter && permissionsBefore.join(",") !== permissionsAfter.join(",")) {
    changes.push({ key: "permissions", before: permissionsBefore, after: permissionsAfter });
  }

  return changes;
}

/**
 * Changements réels entre deux états d'un salon (salon classique ou fil).
 * @returns {Array<{key:string,before:*,after:*}>}
 */
function channelChanges(oldChannel, newChannel) {
  const changes = [];
  if (!oldChannel || !newChannel) return changes;

  push(changes, "name", text(oldChannel.name), text(newChannel.name));
  push(changes, "topic", nullableText(oldChannel.topic), nullableText(newChannel.topic));
  push(changes, "position", number(oldChannel.position), number(newChannel.position));
  push(changes, "slowmode", number(oldChannel.rateLimitPerUser), number(newChannel.rateLimitPerUser));
  push(changes, "nsfw", boolean(oldChannel.nsfw), boolean(newChannel.nsfw));
  push(changes, "bitrate", number(oldChannel.bitrate), number(newChannel.bitrate));
  push(changes, "userLimit", number(oldChannel.userLimit), number(newChannel.userLimit));

  const parentBefore = oldChannel.parentId || null;
  const parentAfter = newChannel.parentId || null;
  if (parentBefore !== parentAfter) {
    changes.push({
      key: "parent",
      before: channelLabel(oldChannel.parent) || parentBefore,
      after: channelLabel(newChannel.parent) || parentAfter,
    });
  }

  const overwritesBefore = overwriteSignature(oldChannel);
  const overwritesAfter = overwriteSignature(newChannel);
  if (overwritesBefore !== null && overwritesAfter !== null && overwritesBefore !== overwritesAfter) {
    changes.push({ key: "permissions", before: overwritesBefore, after: overwritesAfter });
  }

  return changes;
}

// ─────────────────────────────────────────────────────────────
// Rendu Avant / Après
// ─────────────────────────────────────────────────────────────

/** Valeur lisible d'une propriété, localisée quand c'est pertinent. */
function renderValue(key, value, config) {
  if (value === null || value === undefined || value === "") {
    return CHANGE_LABELS[language(config)].none;
  }

  if (typeof value === "boolean") return booleanLabel(value, config);
  if (key === "permissions") {
    return Array.isArray(value) ? value.join(", ") : String(value);
  }
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

/**
 * Construit les blocs `before` / `after` à partir des changements détectés.
 *
 * @returns {{before:string|null, after:string|null, permissions:string|null}}
 *          `null` partout si aucun changement n'est détecté.
 */
function formatChanges(changes, config) {
  if (!Array.isArray(changes) || changes.length === 0) {
    return { before: null, after: null, permissions: null };
  }

  const beforeLines = [];
  const afterLines = [];
  const permissionLines = [];

  for (const change of changes) {
    const label = changeLabel(change.key, config);
    if (change.key === "permissions") {
      const diff = permissionDiff(
        Array.isArray(change.before) ? change.before : null,
        Array.isArray(change.after) ? change.after : null,
      );
      if (diff) permissionLines.push(`${label} :\n${diff}`);
      else permissionLines.push(`${label} :\n${renderValue(change.key, change.before, config)} → ${renderValue(change.key, change.after, config)}`);
      continue;
    }
    beforeLines.push(`${label} : ${renderValue(change.key, change.before, config)}`);
    afterLines.push(`${label} : ${renderValue(change.key, change.after, config)}`);
  }

  return {
    before: beforeLines.length > 0 ? beforeLines.join("\n") : null,
    after: afterLines.length > 0 ? afterLines.join("\n") : null,
    permissions: permissionLines.length > 0 ? permissionLines.join("\n") : null,
  };
}

module.exports = {
  roleChanges,
  channelChanges,
  formatChanges,
  changeLabel,
  permissionDiff,
  permissionNames,
  overwriteSignature,
  CHANGE_LABELS,
};
