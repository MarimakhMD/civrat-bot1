"use strict";

/**
 * PHASE 1 — registre des actions que le bot s'inflige lui-même.
 *
 * Certaines fonctionnalités produisent un effet Discord qui déclenche à son tour
 * un événement (`guildMemberUpdate`, `guildMemberRemove`…). Sans corrélation,
 * l'événement secondaire est journalisé comme une action distincte : un timeout
 * AutoMod donnait DEUX logs de modération pour une seule sanction.
 *
 * Le chemin qui porte l'information la plus fiable (celui qui connaît la règle
 * violée et la raison) marque l'action ici ; l'écouteur d'événement la consomme
 * et s'abstient. Rien n'est deviné : à défaut de marque, l'événement est
 * journalisé normalement.
 *
 * Le registre est borné en taille et en durée : une marque non consommée ne
 * peut ni fuiter indéfiniment ni masquer une action humaine ultérieure.
 */

const DEFAULT_TTL_MS = 30_000;
const MAX_ENTRIES = 2_000;

/** `kind:guildId:targetId` -> expiresAt */
const marks = new Map();

function keyOf(kind, guildId, targetId) {
  return `${kind}:${guildId}:${targetId}`;
}

function prune(now) {
  if (marks.size < MAX_ENTRIES) return;
  for (const [key, expiresAt] of marks) {
    if (expiresAt <= now) marks.delete(key);
  }
  while (marks.size >= MAX_ENTRIES) {
    const oldest = marks.keys().next().value;
    if (oldest === undefined) break;
    marks.delete(oldest);
  }
}

/**
 * Marque une action auto-infligée.
 * @param {string} kind nature de l'action (`"timeout"`, …)
 * @param {string} guildId
 * @param {string} targetId
 * @param {number} [ttlMs] durée de validité de la marque
 */
function markSelfAction(kind, guildId, targetId, ttlMs = DEFAULT_TTL_MS) {
  if (!kind || !guildId || !targetId) return;
  const now = Date.now();
  prune(now);
  marks.set(keyOf(kind, guildId, targetId), now + ttlMs);
}

/**
 * Consomme une marque : `true` si l'action avait bien été auto-infligée.
 * La marque est retirée dans tous les cas où elle est trouvée valide, afin
 * qu'une seconde lecture ne puisse pas la réutiliser.
 */
function consumeSelfAction(kind, guildId, targetId) {
  if (!kind || !guildId || !targetId) return false;
  const key = keyOf(kind, guildId, targetId);
  const expiresAt = marks.get(key);
  if (expiresAt === undefined) return false;
  marks.delete(key);
  return expiresAt > Date.now();
}

/** Test uniquement. */
function _clearSelfActions() {
  marks.clear();
}

function _getSelfActions() {
  return marks;
}

module.exports = { markSelfAction, consumeSelfAction, _clearSelfActions, _getSelfActions, DEFAULT_TTL_MS };
