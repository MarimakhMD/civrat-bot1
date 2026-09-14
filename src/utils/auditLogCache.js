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
 *     deux requêtes API, et un appel pouvait recevoir la réponse d'un autre.
 *  3. Aucune consommation — la même entrée était resservie indéfiniment pendant
 *     3 s, donc rejouée pour plusieurs événements distincts.
 *
 * PHASE 1 (correctif 2) — UN ÉCHEC N'EST PLUS UNE ABSENCE.
 *
 * Le `catch` renvoyait `[]` puis mettait cette liste vide en cache 3 s, sans
 * aucun log. Une permission « Voir les logs d'audit » manquante ou un rate limit
 * produisaient donc exactement le même résultat qu'une absence d'entrée :
 * aucun log de rôle, aucune trace, aucun moyen de diagnostiquer. Désormais :
 *  • seuls les SUCCÈS sont mis en cache ;
 *  • `readAuditLog` distingue `available: false` (lecture impossible, avec
 *    motif) d'une liste réellement vide ;
 *  • l'échec est journalisé une fois par `(guild_id, type)` et par minute.
 *
 * L'isolation reste stricte : la clé de cache, de vol et de journalisation est
 * `guildId:type`.
 *
 * La consommation (marquer une entrée comme déjà attribuée) vit dans
 * `auditLogActor.js`, qui connaît la sémantique métier.
 */

const logger = require("./logger");

const CACHE_TTL_MS = 3000;

/** Taille du lot lu à chaque requête. Assez pour séparer des changements rapprochés. */
const DEFAULT_LIMIT = 25;

/** Anti-bruit : un serveur sans la permission lèverait à chaque événement. */
const FAILURE_WARN_DEDUP_MS = 60_000;

/** Borne du registre d'anti-bruit (guildes × types). */
const FAILURE_WARN_MAX_KEYS = 500;

/** `guildId:type` -> { entries, expiresAt }. Contient uniquement des SUCCÈS. */
const cache = new Map();

/** `guildId:type` -> Promise<{entries, available, reason}> : vols en cours. */
const inflight = new Map();

/** `guildId:type` -> horodatage du dernier avertissement émis. */
const failureWarnedAt = new Map();

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

/** Motif lisible d'un échec de lecture — sans jamais remonter l'erreur brute. */
function auditFailureReason(error) {
  const code = error && (error.code !== undefined ? error.code : error.status);
  const message = (error && error.message) ? String(error.message) : "";
  if (code === 50013 || /missing permissions/i.test(message)) return "MISSING_PERMISSIONS";
  if (code === 429 || /rate ?limit/i.test(message)) return "RATE_LIMITED";
  if (code === 50001 || /missing access/i.test(message)) return "MISSING_ACCESS";
  return "READ_FAILED";
}

function warnFailureOnce(key, guildId, type, reason) {
  const now = Date.now();
  const last = failureWarnedAt.get(key);
  if (last !== undefined && now - last < FAILURE_WARN_DEDUP_MS) return;
  if (failureWarnedAt.size >= FAILURE_WARN_MAX_KEYS && !failureWarnedAt.has(key)) failureWarnedAt.clear();
  failureWarnedAt.set(key, now);
  logger.warn("Audit log read failed", {
    event: "AUDIT_LOG_READ_FAILED",
    guildId,
    type,
    reason,
  });
}

/**
 * Lit les entrées d'audit les plus récentes pour un type donné, en distinguant
 * « lecture impossible » d'une liste réellement vide.
 *
 * @param {object} guild guilde Discord (doit exposer `id` et `fetchAuditLogs`)
 * @param {number} type valeur d'`AuditLogEvent`
 * @returns {Promise<{entries: object[], available: boolean, reason: string|null}>}
 */
async function readAuditLog(guild, type) {
  if (!guild || !guild.id) {
    return { entries: [], available: false, reason: "GUILD_UNAVAILABLE" };
  }

  const key = cacheKey(guild.id, type);
  const now = Date.now();

  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) {
    return { entries: cached.entries, available: true, reason: null };
  }

  // Single-flight : tant qu'une requête est en vol pour cette clé, tout nouvel
  // appel attend SON résultat au lieu de déclencher une seconde requête API.
  const pending = inflight.get(key);
  if (pending) return pending;

  const request = (async () => {
    try {
      const logs = await guild.fetchAuditLogs({ type, limit: DEFAULT_LIMIT });
      const entries = toEntryArray(logs);
      // Seuls les SUCCÈS sont mis en cache : un échec doit être retenté au
      // prochain événement, jamais resservi comme une absence d'entrée.
      cache.set(key, { entries, expiresAt: Date.now() + CACHE_TTL_MS });
      return { entries, available: true, reason: null };
    } catch (error) {
      const reason = auditFailureReason(error);
      warnFailureOnce(key, guild.id, type, reason);
      return { entries: [], available: false, reason };
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, request);
  return request;
}

/**
 * Rétrocompatible : renvoie uniquement les entrées, de la plus récente à la
 * plus ancienne ; `[]` si la lecture est indisponible.
 */
async function fetchAuditLogEntries(guild, type) {
  const result = await readAuditLog(guild, type);
  return result.entries;
}

/**
 * Rétrocompatible : renvoie l'entrée la plus récente du type demandé, ou `null`.
 * Préférer `readAuditLog` + les résolveurs de `auditLogActor.js`, qui vérifient
 * la cible, la fraîcheur et la consommation.
 */
async function fetchAuditLog(guild, type) {
  const entries = await fetchAuditLogEntries(guild, type);
  return entries[0] || null;
}

function _clearCache() {
  cache.clear();
  inflight.clear();
  failureWarnedAt.clear();
}

function _getCache() {
  return cache;
}

function _getInflight() {
  return inflight;
}

function _getFailureWarnedAt() {
  return failureWarnedAt;
}

module.exports = {
  fetchAuditLog,
  fetchAuditLogEntries,
  readAuditLog,
  auditFailureReason,
  _clearCache,
  _getCache,
  _getInflight,
  _getFailureWarnedAt,
  CACHE_TTL_MS,
  DEFAULT_LIMIT,
  FAILURE_WARN_DEDUP_MS,
};
