"use strict";

/**
 * B1 — Persistance des warnings.
 *
 * Table réelle : public.warnings (migration B1 appliquée et vérifiée)
 *   id bigint generated always as identity
 *   guild_id text NOT NULL · user_id text NOT NULL · moderator_id text NOT NULL
 *   reason text (nullable)
 *   created_at timestamptz NOT NULL DEFAULT now()
 *   PK warnings_pkey (id) · index idx_warnings_guild_user_created
 *     (guild_id, user_id, created_at DESC)
 *   RLS activée, AUCUNE policy, service_role = INSERT + SELECT uniquement.
 *
 * APPEND-ONLY
 * -----------
 * Le contrat n'expose volontairement AUCUNE méthode de mise à jour ni de
 * suppression, et la base ne concède ni UPDATE ni DELETE à service_role. Un
 * warning est donc un fait immuable : c'est ce qui rend l'historique fiable
 * (§17) et ce qui rend un futur /unwarn possible sans refaire le schéma — il
 * passera par une colonne de révocation ajoutée plus tard, jamais par une
 * modification de cette table.
 *
 * CONCURRENCE
 * -----------
 * Contrairement à l'XP (B3), il n'y a ici aucun read-modify-write : chaque
 * warning est un INSERT indépendant. Deux avertissements simultanés produisent
 * donc deux lignes, sans lost update possible et sans compare-and-swap.
 */

/** Longueur maximale d'une raison (décision B1-6). Rejet strict, jamais de troncature. */
const REASON_MAX_LENGTH = 500;

/** Nombre maximal de warnings renvoyés par listWarnings. */
const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

/**
 * Normalise une raison avant écriture.
 *
 * null / undefined → null (la colonne est nullable et « aucune raison » n'est
 * pas une raison vide). Une raison trop longue est REJETÉE, jamais tronquée :
 * tronquer ferait dire au log autre chose que ce que le modérateur a écrit.
 *
 * @returns {{ok:true, reason:string|null}|{ok:false, code:"WARN_REASON_TOO_LONG"}}
 */
function normalizeReason(reason) {
  if (reason === null || reason === undefined) return { ok: true, reason: null };
  if (typeof reason !== "string") return { ok: true, reason: String(reason) };
  if (reason.length > REASON_MAX_LENGTH) return { ok: false, code: "WARN_REASON_TOO_LONG" };
  return { ok: true, reason };
}

/** Convertit une ligne (snake_case) vers le contrat du module (camelCase). */
function toDomainRow(row) {
  if (!row || typeof row !== "object") return null;
  return Object.freeze({
    id: row.id === null || row.id === undefined ? null : Number(row.id),
    guildId: row.guild_id,
    userId: row.user_id,
    moderatorId: row.moderator_id,
    reason: row.reason === undefined ? null : row.reason,
    createdAt: row.created_at || null,
  });
}

/** Contrat de persistance. Les deux méthodes sont append-only. */
class WarningRepository {
  /**
   * Enregistre un warning.
   * @returns {Promise<{id:number, guildId:string, userId:string, moderatorId:string, reason:string|null, createdAt:string}>}
   */
  async createWarning() {
    throw new Error("createWarning must be implemented");
  }

  /**
   * Historique d'un membre, du plus récent au plus ancien.
   * @returns {Promise<Array>}
   */
  async listWarnings() {
    throw new Error("listWarnings must be implemented");
  }
}

/**
 * Repli en mémoire, utilisé quand Supabase n'est pas disponible.
 *
 * Il applique EXACTEMENT le même contrat et le même ordre de tri que le dépôt
 * Supabase, pour que les tests valident le chemin que la production emprunte.
 * Les warnings y sont perdus au redémarrage : c'est un mode dégradé, pas le
 * comportement nominal.
 */
class InMemoryWarningRepository extends WarningRepository {
  constructor({ clock } = {}) {
    super();
    this.store = [];
    this.nextId = 1;
    this.clock = typeof clock === "function" ? clock : () => Date.now();
  }

  async createWarning({ guildId, userId, moderatorId, reason = null } = {}) {
    if (!guildId || !userId || !moderatorId) {
      throw new TypeError("createWarning requires guildId, userId and moderatorId");
    }
    const normalized = normalizeReason(reason);
    if (!normalized.ok) throw new Error(normalized.code);

    const row = Object.freeze({
      id: this.nextId,
      guild_id: guildId,
      user_id: userId,
      moderator_id: moderatorId,
      reason: normalized.reason,
      created_at: new Date(this.clock()).toISOString(),
    });
    this.nextId += 1;
    this.store.push(row);
    return toDomainRow(row);
  }

  async listWarnings(guildId, userId, limit = DEFAULT_LIST_LIMIT) {
    if (!guildId || !userId) return [];
    const bounded = Number.isFinite(limit) && limit > 0
      ? Math.min(Math.trunc(limit), MAX_LIST_LIMIT)
      : DEFAULT_LIST_LIMIT;

    return this.store
      .filter((row) => row.guild_id === guildId && row.user_id === userId)
      // created_at DESC puis id DESC : id départage deux warnings posés dans la
      // même milliseconde, ce que created_at seul ne permet pas.
      .sort((a, b) => {
        const byDate = Date.parse(b.created_at) - Date.parse(a.created_at);
        return byDate !== 0 ? byDate : b.id - a.id;
      })
      .slice(0, bounded)
      .map(toDomainRow);
  }

  /** Réservé aux tests. */
  clear() {
    this.store = [];
    this.nextId = 1;
  }
}

module.exports = {
  WarningRepository,
  InMemoryWarningRepository,
  normalizeReason,
  toDomainRow,
  REASON_MAX_LENGTH,
  DEFAULT_LIST_LIMIT,
  MAX_LIST_LIMIT,
};
