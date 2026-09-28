"use strict";

/**
 * P6 — ActionRateLimitGuard : rate-limit ciblé et réutilisable.
 *
 * Principes (spec P6 §1) :
 *  • mémoire, mono-process, synchrone (aucun `await` entre check et record :
 *    atomique dans l'event loop Node) ;
 *  • clé isolée `guildId:userId:group` ;
 *  • fenêtre glissante : chaque crédit expire `windowMs` après son usage ;
 *  • expiration lazy À L'ACCÈS + purge des entrées expirées pendant l'usage ;
 *  • taille mémoire bornée (`maxKeys` : balayage puis éviction LRU-ish) ;
 *  • aucune DB, aucun `setInterval`/`setTimeout` global, aucun appel réseau ;
 *  • clock injectable pour les tests.
 *
 * API :
 *  • `check({...})`     — vérifier si une action est autorisée (sans compter) ;
 *  • `record({...})`    — enregistrer l'action (à appeler SI autorisée) ;
 *  • `reset({...})`     — réinitialiser une clé ; `clear()` — tout vider ;
 *  • `retryAfterMs`     — temps restant avant réessai (0 si autorisé).
 *
 * AUCUN rate-limit global uniforme : les seuils vivent dans `RATE_LIMITS`
 * et ne s'appliquent qu'aux actions explicitement branchées sur ce garde.
 */

const RATE_LIMITS = Object.freeze({
  // /suggest — INSERT Supabase + envoi de message : 3 créations / 10 minutes.
  SUGGEST: Object.freeze({ group: "suggest", limit: 3, windowMs: 10 * 60 * 1000 }),
  // TempVoice — création de salon Discord : 4 créations / 60 secondes.
  TEMPVOICE: Object.freeze({ group: "tempvoice", limit: 4, windowMs: 60 * 1000 }),
  // Welcome image — fetch + décodage + Storage + métadonnées : 5 / 5 minutes.
  WELCOME_IMAGE: Object.freeze({ group: "welcomeimg", limit: 5, windowMs: 5 * 60 * 1000 }),
  // Écritures de configuration (upsert guild_configs) : 30 / 60 secondes.
  CONFIG: Object.freeze({ group: "config", limit: 30, windowMs: 60 * 1000 }),
});

function assertPart(name, value) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`ActionRateLimitGuard: ${name} must be a non-empty string`);
  }
}

function assertWindow(limit, windowMs) {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new TypeError("ActionRateLimitGuard: limit must be a positive integer");
  }
  if (!Number.isInteger(windowMs) || windowMs <= 0) {
    throw new TypeError("ActionRateLimitGuard: windowMs must be a positive integer");
  }
}

class ActionRateLimitGuard {
  /**
   * @param {{ clock?: () => number, maxKeys?: number }} [options]
   *   `clock`  — horloge injectable (défaut : `Date.now`) ;
   *   `maxKeys` — plafond de clés en mémoire (défaut : 20 000), borné par
   *   balayage des expirées puis éviction de la plus ancienne clé.
   */
  constructor({ clock = Date.now, maxKeys = 20000 } = {}) {
    if (typeof clock !== "function") {
      throw new TypeError("ActionRateLimitGuard requires an injectable clock function");
    }
    this.clock = clock;
    this.maxKeys = Number.isInteger(maxKeys) && maxKeys > 0 ? maxKeys : 20000;
    /** @type {Map<string, { windowMs: number, timestamps: number[] }>} */
    this.entries = new Map();
  }

  /** Clé d'isolement stricte — toute part manquante lève une TypeError. */
  static key(guildId, userId, group) {
    assertPart("guildId", guildId);
    assertPart("userId", userId);
    assertPart("group", group);
    return `${guildId}:${userId}:${group}`;
  }

  /** Nombre de clés actuellement en mémoire (tests / diagnostics). */
  get size() {
    return this.entries.size;
  }

  /**
   * Purge paresseuse : retire les crédits plus vieux que `windowMs` ; supprime
   * la clé si elle ne contient plus rien (expiration lazy).
   * @returns {number[]} crédits restants (tableau interne, ne pas muter).
   */
  _purge(key, windowMs, now) {
    const bucket = this.entries.get(key);
    if (!bucket) return [];
    const kept = bucket.timestamps.filter((at) => now - at < windowMs);
    if (kept.length === 0) {
      this.entries.delete(key);
      return [];
    }
    bucket.timestamps = kept;
    bucket.windowMs = windowMs;
    return kept;
  }

  /** Balayage des clés entièrement expirées + éviction si toujours trop plein. */
  _boundSize(now) {
    if (this.entries.size < this.maxKeys) return;
    for (const [key, bucket] of this.entries) {
      const kept = bucket.timestamps.filter((at) => now - at < bucket.windowMs);
      if (kept.length === 0) this.entries.delete(key);
      else bucket.timestamps = kept;
    }
    // Toujours trop plein (toutes fraîches) : éviction de la clé la plus
    // ancienne (Map conserve l'ordre d'insertion) — mémoire strictement bornée.
    while (this.entries.size >= this.maxKeys) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  /**
   * Vérifie (sans consommer) si une action est autorisée.
   * @returns {{ allowed: boolean, count: number, remaining: number, retryAfterMs: number }}
   */
  check({ guildId, userId, group, limit, windowMs }) {
    assertWindow(limit, windowMs);
    const key = ActionRateLimitGuard.key(guildId, userId, group);
    const now = this.clock();
    const timestamps = this._purge(key, windowMs, now);
    const count = timestamps.length;
    const allowed = count < limit;
    // Temps restant jusqu'à ce que le compteur redescende sous la limite.
    const retryAfterMs = allowed ? 0 : Math.max(0, timestamps[count - limit] + windowMs - now);
    return { allowed, count, remaining: Math.max(0, limit - count), retryAfterMs };
  }

  /**
   * Enregistre une action (à appeler uniquement quand `check` est autorisé —
   * un enregistrement au-delà de la limite reste possible mais inutile : les
   * appels P6 ne le font jamais).
   * @returns {{ allowed: boolean, count: number, remaining: number, retryAfterMs: number }}
   */
  record({ guildId, userId, group, limit, windowMs }) {
    assertWindow(limit, windowMs);
    const key = ActionRateLimitGuard.key(guildId, userId, group);
    const now = this.clock();
    this._purge(key, windowMs, now);
    if (!this.entries.has(key)) this._boundSize(now);
    let bucket = this.entries.get(key);
    if (!bucket) {
      bucket = { windowMs, timestamps: [] };
      this.entries.set(key, bucket);
    }
    bucket.timestamps.push(now);
    const count = bucket.timestamps.length;
    return {
      allowed: count <= limit,
      count,
      remaining: Math.max(0, limit - count),
      retryAfterMs: 0,
    };
  }

  /** Réinitialise une clé (tests / réarmement explicite). */
  reset({ guildId, userId, group }) {
    this.entries.delete(ActionRateLimitGuard.key(guildId, userId, group));
  }

  /** Vide entièrement le garde (tests). */
  clear() {
    this.entries.clear();
  }
}

// Instance partagée par les routes de production (mono-process assumé).
// Les tests injectent leur propre instance avec clock contrôlée.
const sharedRateLimitGuard = new ActionRateLimitGuard();

/**
 * Garde d'ÉCRITURE de configuration (P6 §5) — à appeler AVANT toute écriture
 * (avant le `read` inutile et surtout avant l'upsert).
 *
 *  • fail-open si `guildId` ou `userId` est absent (route sans acteur — jamais
 *    le cas des routes de configuration en guilde) : jamais d'explosion,
 *    jamais de crash de test existant ;
 *  • au dépassement : répond éphémèrement avec `ratelimit.retry` (non
 *    alarmiste) et retourne `false` — l'appelant ne doit NI écrire NI rendre ;
 *  • autorisé : consomme le crédit et retourne `true`.
 *
 * @param {object} context — contexte de route (guildId, userId, t, envelope,
 *   et éventuellement `rateLimitGuard` injecté par les tests).
 * @param {{ guard?: ActionRateLimitGuard }} [options]
 * @returns {Promise<boolean>} true = écrire autorisé, false = refusé (répondu).
 */
async function enforceConfigWrite(context, { guard = null } = {}) {
  const guildId = context?.guildId;
  const userId = context?.userId;
  if (!guildId || !userId) return true; // fail-open sans acteur
  const active = guard || context?.rateLimitGuard || sharedRateLimitGuard;
  const { group, limit, windowMs } = RATE_LIMITS.CONFIG;
  const gate = active.check({ guildId, userId, group, limit, windowMs });
  if (!gate.allowed) {
    const text = typeof context?.t === "function"
      ? context.t("ratelimit.retry")
      : "ratelimit.retry";
    await context?.envelope?.transport?.reply?.({
      view: { content: text, components: [] },
      ephemeral: true,
    });
    return false;
  }
  active.record({ guildId, userId, group, limit, windowMs });
  return true;
}

module.exports = {
  ActionRateLimitGuard,
  RATE_LIMITS,
  sharedRateLimitGuard,
  enforceConfigWrite,
};
