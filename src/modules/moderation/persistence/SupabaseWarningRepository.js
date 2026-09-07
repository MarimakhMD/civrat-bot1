"use strict";

const {
  WarningRepository,
  normalizeReason,
  toDomainRow,
  DEFAULT_LIST_LIMIT,
  MAX_LIST_LIMIT,
} = require("./WarningRepository");

/**
 * B1 — Dépôt des warnings sur public.warnings (Supabase).
 *
 * Le client doit être PRIVILÉGIÉ (supabaseAdmin) : la RLS de public.warnings
 * n'accorde aucun droit à anon/authenticated, et seul service_role possède
 * INSERT + SELECT. Un client non privilégié échouerait en 42501 sur chaque
 * avertissement.
 *
 * APPEND-ONLY : ce dépôt n'émet que des INSERT et des SELECT. Aucun UPDATE,
 * aucun DELETE — la base ne les concède d'ailleurs pas à service_role.
 */
const WARNINGS_TABLE = "warnings";

/** Code PostgREST « undefined_table ». */
const UNDEFINED_TABLE = "42P01";

/** Colonnes réellement présentes dans public.warnings (migration B1 vérifiée). */
const WARNING_COLUMNS = "id, guild_id, user_id, moderator_id, reason, created_at";

/** Erreur typée : la table warnings est indisponible (migration non appliquée). */
class WarningsUnavailableError extends Error {
  constructor(cause) {
    super("public.warnings is unavailable (migration B1 not applied)");
    this.name = "WarningsUnavailableError";
    this.code = "WARNINGS_UNAVAILABLE";
    this.cause = cause;
  }
}

/**
 * Détecte l'absence de la table.
 *
 * Le code 42P01 est le SEUL signal fiable : classifier sur le texte du message
 * ferait passer un refus de permission (42501) pour une table absente.
 * Convention reprise de M5, M4 et B3.
 */
function isUndefinedTable(error) {
  return Boolean(error) && error.code === UNDEFINED_TABLE;
}

class SupabaseWarningRepository extends WarningRepository {
  /**
   * @param {object} options
   * @param {object} options.supabase Client PRIVILÉGIÉ (supabaseAdmin).
   */
  constructor({ supabase } = {}) {
    super();
    if (!supabase || typeof supabase.from !== "function") {
      throw new TypeError("SupabaseWarningRepository requires a supabase client");
    }
    this.supabase = supabase;
  }

  _table() {
    return this.supabase.from(WARNINGS_TABLE);
  }

  /**
   * Enregistre un warning.
   *
   * `created_at` n'est PAS fourni : la colonne porte DEFAULT now(), c'est donc
   * la base qui fait foi (même convention que member_xp en B3).
   *
   * @returns {Promise<object>} la ligne créée
   * @throws {WarningsUnavailableError} table absente (42P01)
   */
  async createWarning({ guildId, userId, moderatorId, reason = null } = {}) {
    if (!guildId || !userId || !moderatorId) {
      throw new TypeError("createWarning requires guildId, userId and moderatorId");
    }
    const normalized = normalizeReason(reason);
    if (!normalized.ok) throw new Error(normalized.code);

    const { data, error } = await this._table()
      .insert({
        guild_id: guildId,
        user_id: userId,
        moderator_id: moderatorId,
        reason: normalized.reason,
      })
      .select(WARNING_COLUMNS)
      .single();

    if (error) {
      if (isUndefinedTable(error)) throw new WarningsUnavailableError(error);
      throw error;
    }
    return toDomainRow(data);
  }

  /**
   * Historique d'un membre, du plus récent au plus ancien.
   *
   * Le tri `created_at DESC, id DESC` suit l'index
   * idx_warnings_guild_user_created, `id` départageant deux warnings posés dans
   * la même milliseconde.
   */
  async listWarnings(guildId, userId, limit = DEFAULT_LIST_LIMIT) {
    if (!guildId || !userId) return [];
    const bounded = Number.isFinite(limit) && limit > 0
      ? Math.min(Math.trunc(limit), MAX_LIST_LIMIT)
      : DEFAULT_LIST_LIMIT;

    const { data, error } = await this._table()
      .select(WARNING_COLUMNS)
      .eq("guild_id", guildId)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(bounded);

    if (error) {
      if (isUndefinedTable(error)) throw new WarningsUnavailableError(error);
      throw error;
    }
    return (Array.isArray(data) ? data : []).map(toDomainRow);
  }
}

module.exports = {
  SupabaseWarningRepository,
  WarningsUnavailableError,
  isUndefinedTable,
  WARNINGS_TABLE,
};
