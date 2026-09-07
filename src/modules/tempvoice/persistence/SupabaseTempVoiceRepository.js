"use strict";

const { TempVoiceRepository } = require("./TempVoiceRepository");

/**
 * B5-b — Dépôt TempVoice sur public.temp_voice_channels (Supabase).
 *
 * Schéma réel appliqué par la migration B5-a (confirmé en base) :
 *   guild_id text NOT NULL · channel_id text NOT NULL
 *   owner_id text NOT NULL · lobby_id text NOT NULL
 *   created_at timestamptz NOT NULL DEFAULT now()
 *   PK temp_voice_channels_pkey (guild_id, channel_id)
 *   RLS activée, AUCUNE policy : seul service_role a SELECT/INSERT/DELETE.
 *
 * Le cloisonnement par guilde est STRICT : chaque opération porte le filtre
 * `guild_id`, exactement comme le dépôt XP (B3) sur member_xp. Un salon n'est
 * jamais lu, écrit ni supprimé hors de sa guilde.
 */

/** Nom de la table créée par la migration B5-a. */
const TEMP_VOICE_TABLE = "temp_voice_channels";

/** Code PostgREST « relation inexistante » (convention M5 / B3). */
const UNDEFINED_TABLE = "42P01";

/** Code Postgres « violation de contrainte d'unicité » (PK composite). */
const UNIQUE_VIOLATION = "23505";

/** Erreur typée : la table temp_voice_channels est indisponible (migration non appliquée). */
class TempVoiceUnavailableError extends Error {
  constructor(cause) {
    super("public.temp_voice_channels is unavailable (migration B5-a not applied)");
    this.name = "TempVoiceUnavailableError";
    this.code = "TEMPVOICE_UNAVAILABLE";
    this.cause = cause;
  }
}

/**
 * Détecte l'absence de la table.
 *
 * Le code 42P01 est le SEUL signal fiable : classifier sur le texte du message
 * ferait passer un refus de permission (42501) pour une table absente.
 * Convention reprise de M5 (giveaways) et B3 (member_xp).
 */
function isUndefinedTable(error) {
  return Boolean(error) && error.code === UNDEFINED_TABLE;
}

/** Convertit une ligne PostgREST (snake_case) vers le contrat du module (camelCase). */
function toDomainRow(row) {
  if (!row || typeof row !== "object") return null;
  return {
    guildId: row.guild_id,
    channelId: row.channel_id,
    ownerId: row.owner_id,
    lobbyId: row.lobby_id,
    createdAt: row.created_at || null,
  };
}

class SupabaseTempVoiceRepository extends TempVoiceRepository {
  /**
   * @param {object} options
   * @param {object} options.supabase  Client PRIVILÉGIÉ (supabaseAdmin). La RLS
   *   de temp_voice_channels n'accorde rien à anon/authenticated : le client
   *   anonyme échouerait en 42501 sur chaque opération.
   */
  constructor({ supabase } = {}) {
    super();
    if (!supabase || typeof supabase.from !== "function") {
      throw new TypeError("SupabaseTempVoiceRepository requires a supabase client");
    }
    this.supabase = supabase;
  }

  _table() {
    return this.supabase.from(TEMP_VOICE_TABLE);
  }

  /** Persiste un salon temporaire (guild_id, channel_id, owner_id, lobby_id). */
  async create(record) {
    const { data, error } = await this._table()
      .insert({
        guild_id: record.guildId,
        channel_id: record.channelId,
        owner_id: record.ownerId,
        lobby_id: record.lobbyId,
      })
      .select("guild_id, channel_id, owner_id, lobby_id, created_at")
      .maybeSingle();

    if (error) {
      if (isUndefinedTable(error)) throw new TempVoiceUnavailableError(error);
      // 23505 : le salon existe déjà (double création concurrente). Idempotent,
      // jamais une erreur — la ligne existante fait foi.
      if (error.code === UNIQUE_VIOLATION) {
        return {
          guildId: record.guildId,
          channelId: record.channelId,
          ownerId: record.ownerId,
          lobbyId: record.lobbyId,
          createdAt: null,
        };
      }
      throw error;
    }
    return toDomainRow(data);
  }

  /** Lecture d'un salon précis ; null s'il n'existe pas dans la guilde. */
  async findByChannel(guildId, channelId) {
    const { data, error } = await this._table()
      .select("guild_id, channel_id, owner_id, lobby_id, created_at")
      .eq("guild_id", guildId)
      .eq("channel_id", channelId)
      .maybeSingle();

    if (error) {
      if (isUndefinedTable(error)) throw new TempVoiceUnavailableError(error);
      throw error;
    }
    return toDomainRow(data);
  }

  /** Liste les salons temporaires d'une guilde (pour la réconciliation B5-c). */
  async findByGuild(guildId) {
    const { data, error } = await this._table()
      .select("guild_id, channel_id, owner_id, lobby_id, created_at")
      .eq("guild_id", guildId);

    if (error) {
      if (isUndefinedTable(error)) throw new TempVoiceUnavailableError(error);
      throw error;
    }
    if (!Array.isArray(data)) return [];
    return data.map(toDomainRow).filter(Boolean);
  }

  /** Supprime le suivi d'un salon (le salon Discord est déjà supprimé par le transport). */
  async delete(guildId, channelId) {
    const { error } = await this._table()
      .delete()
      .eq("guild_id", guildId)
      .eq("channel_id", channelId);

    if (error) {
      if (isUndefinedTable(error)) throw new TempVoiceUnavailableError(error);
      throw error;
    }
  }
}

module.exports = {
  SupabaseTempVoiceRepository,
  TempVoiceUnavailableError,
  TEMP_VOICE_TABLE,
  isUndefinedTable,
};
