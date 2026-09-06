"use strict";

/**
 * Dépôt Suggestions aligné sur le schéma Supabase RÉEL.
 *
 * public.suggestions (9 colonnes vérifiées) :
 *   id bigint · guild_id text NOT NULL · user_id text NOT NULL
 *   content text NOT NULL · status text DEFAULT 'pending'
 *   upvotes integer DEFAULT 0 · downvotes integer DEFAULT 0
 *   created_at timestamptz DEFAULT now() · updated_at timestamptz DEFAULT now()
 *
 * public.suggestion_votes (4 colonnes, créée par M4) :
 *   suggestion_id bigint NOT NULL · user_id text NOT NULL
 *   value smallint NOT NULL CHECK (value in (1, -1))
 *   created_at timestamptz NOT NULL DEFAULT now()
 *   PRIMARY KEY (suggestion_id, user_id) — une seule ligne par couple
 *   Aucune FK vers suggestions, par décision : une FK installerait des
 *   triggers d'intégrité référentielle sur suggestions.
 *
 * Il n'existe AUCUNE colonne channel_id ni message_id, et aucune colonne
 * author_id / up_votes / down_votes.
 *
 * Le message Discord n'est PAS stocké : les boutons portent l'id de base
 * (suggestion_up:<id>), et l'édition/suppression du message se fait sur le
 * message réellement cliqué, fourni par l'enveloppe d'interaction.
 */

/** Code d'erreur PostgREST « relation inexistante ». */
const UNDEFINED_TABLE = "42P01";

/** Code d'erreur PostgreSQL « violation de contrainte d'unicité ». */
const UNIQUE_VIOLATION = "23505";

/**
 * Erreur typée signalant que public.suggestion_votes est inaccessible.
 *
 * La table existe depuis M4, mais ce garde-fou est CONSERVÉ : il distingue
 * toujours « table absente ou inaccessible » d'un échec réel du vote. Sans
 * lui, le service ne renverrait que SUGGESTION_VOTE_FAILED et une régression
 * de schéma redeviendrait invisible.
 */
class SuggestionVotesUnavailableError extends Error {
  constructor(cause) {
    super("public.suggestion_votes is unavailable");
    this.name = "SuggestionVotesUnavailableError";
    this.code = "SUGGESTION_VOTES_UNAVAILABLE";
    this.cause = cause;
  }
}

/**
 * 4G-5 — Erreur typée : la suggestion n'appartient pas à la guilde demandée.
 *
 * Levée par le DÉPÔT. Le service conserve sa propre garde
 * `suggestion.guild_id !== guildId` ; celle-ci est le second rempart.
 */
class SuggestionNotInGuildError extends Error {
  constructor(guildId, suggestionId) {
    super(`suggestion ${suggestionId} is not in guild ${guildId}`);
    this.name = "SuggestionNotInGuildError";
    this.code = "SUGGESTION_NOT_IN_GUILD";
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

/**
 * Normalise la valeur d'un vote en nombre.
 *
 * `value` est un smallint : PostgREST le sérialise normalement en nombre JSON,
 * mais le code comparait `existing.value === value` de façon STRICTE. Si le
 * pilote renvoyait "1" au lieu de 1, la comparaison échouait silencieusement
 * et chaque vote était traité comme un changement de sens — les compteurs
 * dérivaient sans aucune erreur visible. La conversion explicite supprime ce
 * risque quel que soit le type renvoyé.
 */
function toVoteValue(raw) {
  const value = Number(raw);
  return Number.isFinite(value) ? value : NaN;
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
    // 4G-5 — fail-closed : sans guilde, aucune insertion. `guild_id` est
    // NOT NULL, mais un refus de Postgres remonterait en
    // SUGGESTION_CREATE_FAILED sans nommer la cause.
    if (!guildId || typeof guildId !== "string") {
      throw new TypeError("SupabaseSuggestionRepository.create requires a guildId");
    }
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

  // ───────────────────────────────────────────────────────────────────────
  // 4G-5 — lecture scopée par guilde.
  //
  // Avant, seul `id` filtrait : la requête traversait les guildes et le
  // cloisonnement reposait uniquement sur `suggestion.guild_id !== guildId`
  // dans SuggestionService. Le vecteur est réel : le customId du bouton
  // (`suggestion_up:<id>`) porte l'id de base et un client modifié peut en
  // soumettre un appartenant à une autre guilde. `guildId`, lui, vient de
  // `interaction.guildId` (autorité Discord), il n'est pas forgeable.
  //
  // Fail-closed : sans guilde, aucune requête n'est émise.
  // ───────────────────────────────────────────────────────────────────────
  async findById(guildId, id) {
    if (!guildId || id === undefined || id === null || id === "") return null;
    const { data, error } = await this.supabase
      .from("suggestions").select("*").eq("guild_id", guildId).eq("id", id).maybeSingle();
    if (error) throw error;
    return data;
  }

  /**
   * 4G-5 — prouve en BASE que la suggestion appartient à la guilde.
   *
   * `suggestion_votes` n'a AUCUNE colonne guild_id et AUCUNE FK vers
   * suggestions (décision M4 : une FK installerait des triggers RI). Sans FK,
   * l'embedding PostgREST est impossible et ajouter une colonne est exclu.
   * La seule garantie possible EN BASE est donc cette vérification de
   * parenté, faite par le dépôt lui-même avant toute opération sur l'enfant.
   */
  async #requireSuggestionInGuild(guildId, suggestionId) {
    const parent = await this.findById(guildId, suggestionId);
    if (!parent) throw new SuggestionNotInGuildError(guildId, suggestionId);
    return parent;
  }

  /**
   * Enregistre ou met à jour un vote, puis resynchronise les compteurs.
   *
   * Anti-double-vote : la PK composite (suggestion_id, user_id) rend un second
   * insert impossible en base. Le code traduit le 23505 en `alreadyVoted` au
   * lieu de lever — sans cela, deux clics simultanés du même membre faisaient
   * échouer le second avec une erreur Postgres brute remontée en
   * SUGGESTION_VOTE_FAILED.
   */
  async vote(guildId, id, userId, value) {
    // 4G-5 — la parenté est prouvée en base AVANT toute écriture sur
    // suggestion_votes. Sans cette vérification, un vote sur la suggestion
    // d'une autre guilde serait inscrit, et #syncCounts réécrirait ensuite les
    // compteurs de CETTE suggestion étrangère.
    await this.#requireSuggestionInGuild(guildId, id);
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
      // Comparaison sur des NOMBRES : voir toVoteValue.
      if (toVoteValue(existing.value) === value) return { alreadyVoted: true, vote: existing };

      const { data, error } = await this.supabase
        .from("suggestion_votes").update({ value })
        .eq("suggestion_id", id).eq("user_id", userId).select().single();
      if (error) {
        if (isUndefinedTable(error)) throw new SuggestionVotesUnavailableError(error);
        throw error;
      }

      await this.#syncCounts(guildId, id);
      return { alreadyVoted: false, vote: data };
    }

    const { data, error } = await this.supabase
      .from("suggestion_votes").insert({ suggestion_id: id, user_id: userId, value })
      .select().single();
    if (error) {
      if (isUndefinedTable(error)) throw new SuggestionVotesUnavailableError(error);
      // Insert concurrent : un autre vote du même membre a gagné la course.
      // Ce n'est pas un échec — le gagnant synchronise les compteurs.
      if (error.code === UNIQUE_VIOLATION) return { alreadyVoted: true };
      throw error;
    }

    await this.#syncCounts(guildId, id);
    return { alreadyVoted: false, vote: data };
  }

  /**
   * Compte EXACT les votes d'une valeur donnée.
   *
   * Requête HEAD + Prefer: count=exact (technique éprouvée en P10 sur
   * analytics_events) : le total arrive dans l'en-tête Content-Range et
   * AUCUNE ligne n'est transférée. Insensible à db-max-rows.
   */
  async #countVotes(suggestionId, value) {
    const { count, error } = await this.supabase
      .from("suggestion_votes")
      .select("value", { count: "exact", head: true })
      .eq("suggestion_id", suggestionId)
      .eq("value", value);
    if (error) {
      if (isUndefinedTable(error)) throw new SuggestionVotesUnavailableError(error);
      throw error;
    }
    const total = Number(count);
    return Number.isFinite(total) && total >= 0 ? total : 0;
  }

  /**
   * Resynchronise suggestions.upvotes / downvotes par RECALCUL.
   *
   * ⚠️ L'ancienne implémentation faisait lecture-modification-écriture
   * (`select upvotes, downvotes` → +1 en JS → `update`). Deux votes
   * simultanés lisaient la même valeur et réécrivaient le même résultat :
   * un vote était perdu DÉFINITIVEMENT, sans aucune erreur.
   *
   * Le recalcul depuis suggestion_votes est idempotent et auto-correcteur :
   * deux exécutions concurrentes calculent la même valeur juste, la ligne de
   * vote étant déjà commise. Aucune dérive permanente n'est possible.
   *
   * Aucun RPC n'est nécessaire — c'était l'alternative plus lourde, écartée.
   */
  async #syncCounts(guildId, suggestionId) {
    const [upvotes, downvotes] = await Promise.all([
      this.#countVotes(suggestionId, 1),
      this.#countVotes(suggestionId, -1),
    ]);
    // 4G-5 — la réécriture des compteurs est scopée par guilde. Sans ce
    // filtre, un vote accepté sur une suggestion étrangère écraserait ses
    // compteurs ; avec lui, l'UPDATE ne peut toucher que la bonne guilde.
    const { error } = await this.supabase
      .from("suggestions").update({ upvotes, downvotes })
      .eq("guild_id", guildId).eq("id", suggestionId);
    if (error) throw error;
  }

  async updateStatus(guildId, id, status) {
    // 4G-5 — UPDATE scopé par guilde dans la requête.
    if (!guildId || id === undefined || id === null || id === "") {
      throw new TypeError("SupabaseSuggestionRepository.updateStatus requires a guildId and an id");
    }
    const { data, error } = await this.supabase
      .from("suggestions").update({ status }).eq("guild_id", guildId).eq("id", id).select().single();
    if (error) throw error;
    return data;
  }

  /**
   * Supprime la suggestion puis ses votes.
   *
   * Il n'y a aucune FK (décision M4) : le nettoyage est donc à la charge du
   * code. Un échec du nettoyage ne doit PAS faire échouer une suppression de
   * suggestion déjà effective — l'ancien code levait après coup et le service
   * répondait SUGGESTION_ACTION_FAILED alors que la ligne avait bien disparu.
   */
  async delete(guildId, id) {
    // 4G-5 — deux défauts corrigés d'un seul coup.
    //
    //   1. Le DELETE filtrait sur `id` seul : il traversait les guildes.
    //   2. Le retour était { deleted: true } INCONDITIONNEL, et le nettoyage
    //      des votes partait sur .eq("suggestion_id", id) seul. Conséquence :
    //      même lorsque la ligne parente n'était PAS supprimée, les votes
    //      d'une suggestion ÉTRANGÈRE étaient détruits. C'était le seul
    //      chemin du module capable de détruire des données d'une autre
    //      guilde, et il ne produisait aucune erreur.
    //
    // Le DELETE est donc scopé dans la requête, et le nombre de lignes
    // réellement supprimées est vérifié AVANT de toucher à la table enfant.
    // `.select("id")` demande le RETURNING : sans lui, PostgREST ne dit pas
    // combien de lignes ont disparu.
    if (!guildId || id === undefined || id === null || id === "") {
      throw new TypeError("SupabaseSuggestionRepository.delete requires a guildId and an id");
    }
    const { data, error } = await this.supabase
      .from("suggestions").delete().eq("guild_id", guildId).eq("id", id).select("id");
    if (error) throw error;
    const removed = Array.isArray(data) ? data.length : (data ? 1 : 0);
    if (removed === 0) return { deleted: false };
    try {
      await this.supabase.from("suggestion_votes").delete().eq("suggestion_id", id);
    } catch {
      // Sans FK, un vote orphelin est toléré : il ne fausse aucun compteur,
      // les compteurs étant recalculés par suggestion_id.
    }
    return { deleted: true };
  }
}

module.exports = {
  SupabaseSuggestionRepository,
  SuggestionVotesUnavailableError,
  SuggestionNotInGuildError,
};
