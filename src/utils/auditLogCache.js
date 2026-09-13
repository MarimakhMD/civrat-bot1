"use strict";

/**
 * PHASE 1 — lecture de l'Audit Log Discord, fiable sous concurrence.
 *
 * POURQUOI CE FICHIER A CHANGÉ
 * ----------------------------
 * L'ancienne version faisait `fetchAuditLogs({ type, limit: 1 })` et mettait en
 * cache l'entrée unique pendant 3 s, sous la clé `guildId:type`. Trois défauts
 * mesurés :
 *
 *  1. `limit: 1` — sous concurrence, deux membres modifiés dans la même fenêtre
 *     ne voyaient qu'UNE entrée : le second recevait l'entrée du premier, la
 *     garde de cible la rejetait, et son changement n'était JAMAIS journalisé.
 *  2. Cache partagé — deux appels simultanés pour la même clé déclenchaient
 *     deux requêtes API (la seconde partait avant que la première n'ait rempli
 *     le cache), et un appel pouvait recevoir la réponse destinée à un autre.
 *  3. Aucune consommation — la même entrée était resservie indéfiniment pendant
 *     3 s, donc rejouée pour plusieurs événements distincts.
 *
 * Ce module corrige les trois :
 *  • lecture par lots (`limit: 25`) : les changements rapprochés sont séparés ;
 *  • « single-flight » : deux appels simultanés pour la même clé partagent UNE
 *    seule requête API ;
 *  • le cache conserve la LISTE des entrées, pas seulement la première.
 *
 * La consommation (marquer une entrée comme déjà attribuée) vit dans
 * `auditLogActor.js`, qui connaît la sémantique métier.
 */

const CACHE_TTL_MS = 3000;

/** Taille du lot lu à chaque requête. Assez pour séparer des changements rapprochés. */
const DEFAULT_LIMIT = 25;

/** `guildId:type` -> { entries, expiresAt } */
const cache = new Map();

/** `guildId:type` -> Promise<entries> : requêtes en cours, pour le single-flight. */
const inflight = new Map();

function cacheKey(guildId, type) {
  return `${guildId}:${type}`;
}

/**
 * Normalise la réponse de `guild.fetchAuditLogs()` en tableau.
 *
 * discord.js renvoie une `Collection` (qui expose `filter`). Certains mocks de
 * test n'exposent que `first()` : on accepte les deux formes plutôt que de
 * casser au premier objet partiel.
 */
function toEntryArray(logs) {
  const entries = logs && logs.entries;
  if (!entries) return [];
  if (typeof entries.filter === "function") {
    const list = entries.filter(() => true);
    return Array.isArray(list) ? list : [...list];
  }
  const first = typeof entries.first === "function" ? entries.first() : null;
  return first ? [first] : [];
}

/**
 * Lit les entrées d'audit les plus récentes pour un type donné.
 *
 * @param {object} guild guilde Discord (doit exposer `id` et `fetchAuditLogs`)
 * @param {number} type valeur d'`AuditLogEvent`
 * @returns {Promise<object[]>} entrées de la plus récente à la plus ancienne ; `[]` si indisponible
 */
async function fetchAuditLogEntries(guild, type) {
  if (!guild || !guild.id) return [];

  const key = cacheKey(guild.id, type);
  const now = Date.now();

  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) return cached.entries;

  // Single-flight : tant qu'une requête est en vol pour cette clé, tout nouvel
  // appel attend SON résultat au lieu de déclencher une seconde requête API.
  const pending = inflight.get(key);
  if (pending) return pending;

  const request = (async () => {
    try {
      const logs = await guild.fetchAuditLogs({ type, limit: DEFAULT_LIMIT });
      return toEntryArray(logs);
    } catch {
      // Indisponibilité (rate limit, permissions) : liste vide, jamais de levée.
      return [];
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, request);
  const entries = await request;
  cache.set(key, { entries, expiresAt: Date.now() + CACHE_TTL_MS });
  return entries;
}

/**
 * Rétrocompatible : renvoie l'entrée la plus récente du type demandé, ou `null`.
 * Préférer `fetchAuditLogEntries` + les résolveurs de `auditLogActor.js`, qui
 * vérifient la cible, la fraîcheur et la consommation.
 */
async function fetchAuditLog(guild, type) {
  const entries = await fetchAuditLogEntries(guild, type);
  return entries[0] || null;
}

function _clearCache() {
  cache.clear();
  inflight.clear();
}

function _getCache() {
  return cache;
}

function _getInflight() {
  return inflight;
}

module.exports = {
  fetchAuditLog,
  fetchAuditLogEntries,
  _clearCache,
  _getCache,
  _getInflight,
  CACHE_TTL_MS,
  DEFAULT_LIMIT,
};
