"use strict";

/**
 * C1 — Dépôt Giveaways aligné sur le schéma Supabase RÉEL.
 *
 * Colonnes réelles de public.giveaways (14, vérifiées) :
 *   id bigint identity · guild_id text NOT NULL · title text NOT NULL
 *   description text nullable default '' · channel_id text nullable
 *   duration integer NOT NULL · winners_count integer nullable default 1
 *   requirements text nullable default '' · active boolean nullable default true
 *   status text nullable default 'active' · ends_at timestamptz NOT NULL
 *   ended_at timestamptz nullable · created_at timestamptz default now()
 *   updated_at timestamptz default now()
 *
 * Il n'existe AUCUNE colonne prize ni message_id. Avant C1, create() écrivait
 * ces deux colonnes inconnues ET omettait title et duration, toutes deux
 * NOT NULL : l'INSERT échouait donc pour quatre motifs indépendants.
 *
 * CONVENTION : `duration` est stocké en MINUTES, cohérent avec le
 * `durationMinutes` fourni par le service. `ends_at` porte de toute façon
 * l'échéance absolue ; `duration` reste informatif.
 *
 * `giveaway_entries` relève de la migration M5, NON appliquée. Aucune table
 * n'est créée ici : les méthodes concernées signalent explicitement leur
 * indisponibilité au lieu d'échouer silencieusement.
 */

/** Code d'erreur PostgREST « relation inexistante ». */
const UNDEFINED_TABLE = "42P01";

/**
 * Erreur typée signalant que public.giveaway_entries n'existe pas encore.
 *
 * Sans ce typage, le service ne pouvait renvoyer que GIVEAWAY_JOIN_FAILED ou
 * GIVEAWAY_DRAW_FAILED, ce qui confondait « table absente » et « échec réel ».
 */
class GiveawayEntriesUnavailableError extends Error {
  constructor(cause) {
    super("public.giveaway_entries is unavailable (migration M5 not applied)");
    this.name = "GiveawayEntriesUnavailableError";
    this.code = "GIVEAWAY_ENTRIES_UNAVAILABLE";
    this.cause = cause;
  }
}

/**
 * Détecte l'absence de la table giveaway_entries.
 *
 * Le code PostgREST 42P01 est le SEUL signal fiable. Un repli sur le texte du
 * message a été écarté : il classerait à tort un refus de permission (42501)
 * sur giveaway_entries comme une table absente, faisant diagnostiquer
 * « M5 non appliquée » à la place d'un vrai problème de droits. Le repli
 * textuel n'est conservé que si le client ne fournit AUCUN code, et exige
 * alors la formulation Postgres exacte.
 */
function isUndefinedTable(error) {
  if (!error) return false;
  if (error.code) return error.code === UNDEFINED_TABLE;
  return /relation "[^"]*" does not exist/i.test(String(error.message || ""));
}

class SupabaseGiveawayRepository {
  constructor({ supabase }) {
    if (!supabase || typeof supabase.from !== "function") {
      throw new TypeError("SupabaseGiveawayRepository requires a supabase client");
    }
    this.supabase = supabase;
  }

  /**
   * Crée un giveaway.
   *
   * N'écrit que des colonnes réelles. `title` et `duration` sont NOT NULL :
   * leur absence est rejetée ici plutôt que par PostgREST, pour que l'erreur
   * nomme la cause au lieu d'être noyée en GIVEAWAY_CREATE_FAILED.
   */
  async create({ guildId, channelId, title, description, winnersCount, duration, requirements, endsAt }) {
    if (!title || typeof title !== "string" || !title.trim()) {
      throw new TypeError("SupabaseGiveawayRepository.create requires a non-empty title");
    }
    if (!Number.isFinite(duration)) {
      throw new TypeError("SupabaseGiveawayRepository.create requires a numeric duration");
    }
    if (!endsAt) {
      throw new TypeError("SupabaseGiveawayRepository.create requires endsAt");
    }
    const record = {
      guild_id: guildId,
      channel_id: channelId ?? null,
      title: title.trim(),
      description: description ?? "",
      duration,
      winners_count: winnersCount ?? 1,
      requirements: requirements ?? "",
      active: true,
      status: "active",
      ends_at: endsAt,
    };
    const { data, error } = await this.supabase.from("giveaways").insert(record).select().single();
    if (error) throw error;
    return data;
  }

  async findById(id) {
    const { data, error } = await this.supabase.from("giveaways").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data;
  }

  /**
   * Inscrit un participant.
   *
   * ⛔ Indisponible tant que public.giveaway_entries n'existe pas (M5).
   */
  async join(giveawayId, userId) {
    const { data, error } = await this.supabase
      .from("giveaway_entries").insert({ giveaway_id: giveawayId, user_id: userId })
      .select().single();
    if (error) {
      if (isUndefinedTable(error)) throw new GiveawayEntriesUnavailableError(error);
      if (error.code === "23505") return { alreadyJoined: true };
      throw error;
    }
    return { alreadyJoined: false, entry: data };
  }

  /** ⛔ Indisponible tant que public.giveaway_entries n'existe pas (M5). */
  async listEntries(giveawayId) {
    const { data, error } = await this.supabase
      .from("giveaway_entries").select("user_id").eq("giveaway_id", giveawayId);
    if (error) {
      if (isUndefinedTable(error)) throw new GiveawayEntriesUnavailableError(error);
      throw error;
    }
    return data || [];
  }

  /**
   * Tire les gagnants au sort.
   *
   * ⛔ Indisponible tant que public.giveaway_entries n'existe pas (M5).
   * Ne vérifie PAS l'état du giveaway : la garde anti-double-tirage appartient
   * au service, qui seul connaît la règle métier.
   */
  async draw(giveawayId) {
    const entries = await this.listEntries(giveawayId);
    if (!entries.length) return { winners: [], entries };
    const shuffled = [...entries].sort(() => Math.random() - 0.5);
    const giveaway = await this.findById(giveawayId);
    const count = giveaway && giveaway.winners_count ? giveaway.winners_count : 1;
    return { winners: shuffled.slice(0, count).map((e) => e.user_id), entries };
  }

  /**
   * Clôt un giveaway.
   *
   * Pose les TROIS champs réels de clôture :
   *   • active  = false  → c'est ce booléen qui fait autorité sur l'état
   *                        ouvert/fermé (garde anti-double-tirage) ;
   *   • status  = 'ended'→ valeur cible retenue. ⚠️ DÉCISION DE CONCEPTION :
   *                        aucun CHECK ni jeu de valeurs historique n'a été
   *                        vérifié en base, la table étant vide. Le défaut réel
   *                        de la colonne est 'active'.
   *   • ended_at = now() → colonne réelle, jamais renseignée avant C1.
   *
   * L'ancien code n'écrivait que status: "closed" — valeur absente du schéma
   * réel — et laissait active à true, donc un giveaway « clos » restait
   * tirable.
   */
  async close(giveawayId) {
    const record = { active: false, status: "ended", ended_at: new Date().toISOString() };
    const { data, error } = await this.supabase.from("giveaways").update(record).eq("id", giveawayId).select().single();
    if (error) throw error;
    return data;
  }
}

module.exports = { SupabaseGiveawayRepository, GiveawayEntriesUnavailableError };
