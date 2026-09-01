"use strict";

/**
 * C2 — Dépôt Suggestions aligné sur le schéma Supabase RÉEL.
 *
 * Colonnes réelles de public.suggestions (9, vérifiées) :
 *   id bigint · guild_id text NOT NULL · user_id text NOT NULL
 *   content text NOT NULL · status text DEFAULT 'pending'
 *   upvotes integer DEFAULT 0 · downvotes integer DEFAULT 0
 *   created_at timestamptz DEFAULT now() · updated_at timestamptz DEFAULT now()
 *
 * Il n'existe AUCUNE colonne channel_id ni message_id, et aucune colonne
 * author_id / up_votes / down_votes. Le code écrit donc uniquement les 9
 * colonnes ci-dessus ; aucune colonne n'est créée ni renommée en base.
 *
 * Le message Discord n'est PAS stocké : les boutons portent l'id de base
 * (suggestion_up:<id>), et l'édition/suppression du message se fait sur le
 * message réellement cliqué, fourni par l'enveloppe d'interaction.
 */

/** Code d'erreur PostgREST « relation inexistante ». */
const UNDEFINED_TABLE = "42P01";

/**
 * Erreur typée signalant que public.suggestion_votes n'existe pas encore.
 *
 * Cette table relève de la migration M4, non exécutée. Sans ce typage, le
 * service ne pouvait renvoyer que SUGGESTION_VOTE_FAILED, ce qui confondait
 * « table absente » et « échec réel du vote ».
 */
class SuggestionVotesUnavailableError extends Error {
  constructor(cause) {
    super("public.suggestion_votes is unavailable (migration M4 not applied)");
    this.name = "SuggestionVotesUnavailableError";
    this.code = "SUGGESTION_VOTES_UNAVAILABLE";
    this.cause = cause;
  }
}

/**
 * Détecte l'absence de la table suggestion_votes.
 *
 * Le code PostgREST 42P01 (« undefined_table ») est le SEUL signal fiable.
 * Un repli sur le texte du message a d'abord été écrit ici, puis retiré : il
 * classait à tort un refus de permission (42501) sur suggestion_votes comme
 * une table absente, ce qui aurait fait diagnostiquer « migration M4 non
 * appliquée » à la place d'un vrai problème de droits.
 * Le repli textuel n'est conservé que si le client ne fournit AUCUN code, et
 * il exige alors la formulation Postgres exacte.
 */
function isUndefinedTable(error) {
  if (!error) return false;
  if (error.code) return error.code === UNDEFINED_TABLE;
  return /relation "[^"]*" does not exist/i.test(String(error.message || ""));
}

class SupabaseSuggestionRepository {
  constructor({ supabase }) {
    if (!supabase || typeof supabase.from !== "function") {
      throw new TypeError("SupabaseSuggestionRepository requires a supabase client");
    }
    this.supabase = supabase;
  }

  /**
   * Crée une suggestion.
   *
   * N'écrit que des colonnes réelles. `status`, `upvotes` et `downvotes` sont
   * écrits explicitement plutôt que laissés à leur DEFAULT : le comportement
   * ne dépend alors plus d'un changement de valeur par défaut en base.
   */
  async create({ guildId, userId, content }) {
    const record = {
      guild_id: guildId,
      user_id: userId,
      content,
      status: "pending",
      upvotes: 0,
      downvotes: 0,
    };
    const { data, error } = await this.supabase.from("suggestions").insert(record).select().single();
    if (error) throw error;
    return data;
  }

  async findById(id) {
    const { data, error } = await this.supabase.from("suggestions").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data;
  }

  /**
   * Enregistre ou met à jour un vote, puis resynchronise les compteurs.
   *
   * ⚠️ LIMITATION CONNUE, assumée : la resynchronisation des compteurs est
   * lecture-modification-écriture, donc non atomique. Deux votes simultanés
   * peuvent en perdre un. La correction exige une fonction RPC d'incrément
   * atomique, donc une migration — hors périmètre de C2 (code-only).
   */
  async vote(id, userId, value) {
    let existing;
    {
      const { data, error } = await this.supabase
        .from("suggestion_votes").select("*")
        .eq("suggestion_id", id).eq("user_id", userId).maybeSingle();
      if (error) {
        if (isUndefinedTable(error)) throw new SuggestionVotesUnavailableError(error);
        throw error;
      }
      existing = data;
    }

    if (existing) {
      if (existing.value === value) return { alreadyVoted: true, vote: existing };

      const { data, error } = await this.supabase
        .from("suggestion_votes").update({ value })
        .eq("suggestion_id", id).eq("user_id", userId).select().single();
      if (error) {
        if (isUndefinedTable(error)) throw new SuggestionVotesUnavailableError(error);
        throw error;
      }

      await this.#applyCounts(id, (upvotes, downvotes) => {
        if (value === 1 && existing.value === -1) return { upvotes: upvotes + 1, downvotes: downvotes - 1 };
        if (value === -1 && existing.value === 1) return { upvotes: upvotes - 1, downvotes: downvotes + 1 };
        return { upvotes, downvotes };
      });
      return { alreadyVoted: false, vote: data };
    }

    const { data, error } = await this.supabase
      .from("suggestion_votes").insert({ suggestion_id: id, user_id: userId, value })
      .select().single();
    if (error) {
      if (isUndefinedTable(error)) throw new SuggestionVotesUnavailableError(error);
      throw error;
    }

    await this.#applyCounts(id, (upvotes, downvotes) => ({
      upvotes: upvotes + (value === 1 ? 1 : 0),
      downvotes: downvotes + (value === -1 ? 1 : 0),
    }));
    return { alreadyVoted: false, vote: data };
  }

  /** Lit les compteurs réels (`upvotes`/`downvotes`), applique `mutate`, réécrit. */
  async #applyCounts(id, mutate) {
    const { data: row, error } = await this.supabase
      .from("suggestions").select("upvotes, downvotes").eq("id", id).single();
    if (error) throw error;
    const next = mutate(Number(row.upvotes) || 0, Number(row.downvotes) || 0);
    const { error: updateError } = await this.supabase
      .from("suggestions").update({ upvotes: next.upvotes, downvotes: next.downvotes }).eq("id", id);
    if (updateError) throw updateError;
  }

  async updateStatus(id, status) {
    const { data, error } = await this.supabase.from("suggestions").update({ status }).eq("id", id).select().single();
    if (error) throw error;
    return data;
  }

  /**
   * Supprime la suggestion.
   *
   * Le nettoyage de suggestion_votes est délibérément tolérant : la table
   * n'existe pas avant M4 et il n'y a aucune clé étrangère, donc la supprimer
   * en premier ne laisse aucun orphelin bloquant. Surtout, un échec ici ne
   * doit PAS faire échouer une suppression de suggestion déjà effective —
   * l'ancien code levait après coup et le service répondait
   * SUGGESTION_ACTION_FAILED alors que la ligne avait bien disparu.
   */
  async delete(id) {
    const { error } = await this.supabase.from("suggestions").delete().eq("id", id);
    if (error) throw error;
    try {
      await this.supabase.from("suggestion_votes").delete().eq("suggestion_id", id);
    } catch {
      // suggestion_votes absente avant M4 : rien à nettoyer.
    }
    return { deleted: true };
  }
}

module.exports = { SupabaseSuggestionRepository, SuggestionVotesUnavailableError };
