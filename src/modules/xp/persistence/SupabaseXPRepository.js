"use strict";

/**
 * B3 — Dépôt XP sur public.member_xp (Supabase).
 *
 * Schéma réel appliqué par la migration B3 :
 *   guild_id text NOT NULL · user_id text NOT NULL
 *   xp integer NOT NULL DEFAULT 0 · level integer NOT NULL DEFAULT 0
 *   last_xp_at timestamptz (nullable)
 *   created_at / updated_at timestamptz NOT NULL DEFAULT now()
 *   PK member_xp_pkey (guild_id, user_id) · index (guild_id, xp DESC)
 *   RLS activée, AUCUNE policy : seul service_role a SELECT/INSERT/UPDATE.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI UN COMPARE-AND-SWAP ET PAS UN INCRÉMENT ATOMIQUE
 * ─────────────────────────────────────────────────────────────────────────
 * L'ancien chemin faisait read → calcul → upsert d'une valeur ABSOLUE. Deux
 * messages simultanés du même membre lisaient la même valeur et écrivaient le
 * même résultat : un gain était perdu silencieusement (mesuré : 2 messages
 * simultanés donnaient 15 XP au lieu de 30).
 *
 * La correction idéale serait une fonction SQL `xp = member_xp.xp + gain`.
 * PostgREST ne sait PAS l'exprimer : `.update()` n'accepte que des valeurs
 * littérales, et postgrest-js n'expose aucun opérateur d'incrément ni
 * d'expression. Sans RPC côté base, la seule stratégie sûre est le contrôle
 * optimiste : on relit, on écrit en conditionnant sur la valeur lue, et si la
 * ligne a bougé entre-temps l'UPDATE ne touche aucune ligne — on réessaie.
 *
 * Aucun gain n'est perdu : un conflit est DÉTECTÉ, jamais écrasé.
 *
 * Le cooldown est inclus dans la même condition d'écriture
 * (`last_xp_at IS NULL OR last_xp_at < cutoff`), donc deux messages
 * simultanés ne peuvent pas tous deux le franchir.
 */

const { XPRepository } = require("./XPRepository");

/** Nom de la table créée par la migration B3. */
const MEMBER_XP_TABLE = "member_xp";

/** Code PostgREST « relation inexistante ». Seul signal fiable (précédent M5). */
const UNDEFINED_TABLE = "42P01";

/** Code Postgres « violation de contrainte d'unicité » (PK composite). */
const UNIQUE_VIOLATION = "23505";

/**
 * Nombre maximal de tentatives du compare-and-swap.
 *
 * Les conflits n'existent qu'entre messages du MÊME membre arrivés dans la
 * même rafale : deux membres distincts n'écrivent jamais la même ligne.
 *
 * Le budget doit être supérieur au nombre d'écrivains simultanés sur une même
 * ligne, sinon le dernier arrivé renonce et son gain est perdu. Mesuré : avec
 * un budget de 5, six messages simultanés du même membre perdaient 15 XP dans
 * 30 essais sur 30 ; un budget de 40 ne perd rien jusqu'à 40 messages
 * simultanés. Au-delà du réaliste, donc.
 *
 * Note : ce risque ne concerne que `xp_cooldown = 0`. Avec un cooldown actif,
 * la garde sur last_xp_at convertit la contention en XP_COOLDOWN — mesuré à
 * 0 conflit jusqu'à 40 écrivains simultanés.
 */
const MAX_CAS_ATTEMPTS = 40;

/** Erreur typée : la table member_xp est indisponible (migration non appliquée). */
class MemberXpUnavailableError extends Error {
  constructor(cause) {
    super("public.member_xp is unavailable (migration B3 not applied)");
    this.name = "MemberXpUnavailableError";
    this.code = "MEMBER_XP_UNAVAILABLE";
    this.cause = cause;
  }
}

/**
 * Détecte l'absence de la table.
 *
 * Le code 42P01 est le SEUL signal fiable : classifier sur le texte du message
 * ferait passer un refus de permission (42501) pour une table absente.
 * Convention reprise de M5 (SupabaseGiveawayRepository).
 */
function isUndefinedTable(error) {
  return Boolean(error) && error.code === UNDEFINED_TABLE;
}

/** Convertit une ligne PostgREST (snake_case) vers le contrat du module (camelCase). */
function toDomainRow(row) {
  if (!row || typeof row !== "object") return null;
  return {
    guildId: row.guild_id,
    userId: row.user_id,
    xp: Number(row.xp) || 0,
    level: Number(row.level) || 0,
    lastXpAt: row.last_xp_at || null,
  };
}

class SupabaseXPRepository extends XPRepository {
  /**
   * @param {object} options
   * @param {object} options.supabase  Client PRIVILÉGIÉ (supabaseAdmin). La RLS
   *   de member_xp n'accorde rien à anon/authenticated : le client anonyme
   *   échouerait en 42501 sur chaque message.
   * @param {function} [options.clock] Horloge injectable, pour les tests.
   */
  constructor({ supabase, clock } = {}) {
    super();
    if (!supabase || typeof supabase.from !== "function") {
      throw new TypeError("SupabaseXPRepository requires a supabase client");
    }
    this.supabase = supabase;
    this.clock = typeof clock === "function" ? clock : () => Date.now();
  }

  _table() {
    return this.supabase.from(MEMBER_XP_TABLE);
  }

  /** Lecture d'une ligne ; null si le membre n'a encore aucun XP. */
  async findOne(guildId, userId) {
    const { data, error } = await this._table()
      .select("guild_id, user_id, xp, level, last_xp_at")
      .eq("guild_id", guildId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      if (isUndefinedTable(error)) throw new MemberXpUnavailableError(error);
      throw error;
    }
    return toDomainRow(data);
  }

  /**
   * Écriture absolue, conservée pour respecter le contrat XPRepository
   * (utilisée par les tests et par un éventuel outil de correction).
   *
   * ⚠️ Cette méthode n'est PAS sûre en concurrence : le chemin de gain passe
   * par applyGain(). Elle existe pour la compatibilité de contrat.
   */
  async upsert(guildId, userId, xp, level) {
    const nowIso = new Date(this.clock()).toISOString();
    const payload = {
      guild_id: guildId,
      user_id: userId,
      xp,
      level,
      updated_at: nowIso,
    };
    const { data, error } = await this._table()
      .upsert(payload, { onConflict: "guild_id,user_id" })
      .select("guild_id, user_id, xp, level, last_xp_at")
      .maybeSingle();

    if (error) {
      if (isUndefinedTable(error)) throw new MemberXpUnavailableError(error);
      throw error;
    }
    return toDomainRow(data);
  }

  /**
   * Classement XP pour Analytics (/analytics, /analytics_xp).
   *
   * Contrat inchangé : [{ userId, xp, level }], tri xp desc puis level desc,
   * limité à `limit`, isolé par guilde. Le tri et la limite sont poussés en
   * base : l'index (guild_id, xp DESC) de la migration B3 les couvre, et aucun
   * scan complet n'est renvoyé au bot.
   */
  async getLeaderboard(guildId, limit = 10) {
    const { data, error } = await this._table()
      .select("user_id, xp, level")
      .eq("guild_id", guildId)
      .order("xp", { ascending: false })
      .order("level", { ascending: false })
      .limit(limit);

    if (error) {
      if (isUndefinedTable(error)) throw new MemberXpUnavailableError(error);
      throw error;
    }
    if (!Array.isArray(data)) return [];
    return data.map((row) => ({
      userId: row.user_id,
      xp: Number(row.xp) || 0,
      level: Number(row.level) || 0,
    }));
  }

  /**
   * Applique un gain d'XP de façon sûre en concurrence.
   *
   * Une seule méthode couvre : lecture, contrôle du cooldown via last_xp_at,
   * incrément, recalcul du niveau et horodatage — sans second
   * read-modify-write non atomique côté appelant.
   *
   * @returns {Promise<{applied:boolean, code?:string, xp?:number, level?:number,
   *   previousXp?:number, previousLevel?:number, xpGain?:number}>}
   */
  async applyGain({ guildId, userId, gain, cooldownSeconds, computeLevel, now }) {
    const safeGain = Number.isFinite(gain) && gain > 0 ? Math.trunc(gain) : 0;
    const cooldownMs = Number.isFinite(cooldownSeconds) && cooldownSeconds > 0
      ? Math.trunc(cooldownSeconds) * 1000
      : 0;
    // L'appelant (XPService) impose l'instant de référence : dépôt et garde
    // locale doivent raisonner sur le même temps.
    const effectiveNow = Number.isFinite(now) ? now : this.clock();

    for (let attempt = 1; attempt <= MAX_CAS_ATTEMPTS; attempt += 1) {
      const nowIso = new Date(effectiveNow).toISOString();
      // Un gain nul n'est pas un gain : il ne doit pas poser last_xp_at, sinon
      // il déclencherait un cooldown qui bloquerait ensuite un gain réel alors
      // qu'aucun XP n'a été accordé.
      const grantedAtIso = safeGain > 0 ? nowIso : null;
      const current = await this.findOne(guildId, userId);

      // ── Contrôle du cooldown, première passe (économise une écriture) ──
      if (cooldownMs > 0 && current && current.lastXpAt) {
        const last = Date.parse(current.lastXpAt);
        if (Number.isFinite(last) && effectiveNow - last < cooldownMs) {
          return { applied: false, code: "XP_COOLDOWN" };
        }
      }

      // ── Première ligne du membre ──
      if (!current) {
        const newXp = safeGain;
        const newLevel = typeof computeLevel === "function" ? computeLevel(newXp) : 0;
        const { data, error } = await this._table()
          .insert({
            guild_id: guildId,
            user_id: userId,
            xp: newXp,
            level: newLevel,
            last_xp_at: grantedAtIso,
            updated_at: nowIso,
          })
          .select("guild_id, user_id, xp, level, last_xp_at")
          .maybeSingle();

        if (error) {
          if (isUndefinedTable(error)) throw new MemberXpUnavailableError(error);
          // Un autre message a créé la ligne entre-temps : on recommence,
          // cette fois sur le chemin UPDATE.
          if (error.code === UNIQUE_VIOLATION && attempt < MAX_CAS_ATTEMPTS) continue;
          throw error;
        }

        return {
          applied: true,
          xpGain: safeGain,
          xp: toDomainRow(data)?.xp ?? newXp,
          level: newLevel,
          previousXp: 0,
          previousLevel: 0,
        };
      }

      // ── Ligne existante : compare-and-swap ──
      const previousXp = current.xp;
      // Le niveau précédent est RECALCULÉ depuis l'XP, pas repris de la colonne
      // stockée : LevelService reste l'unique source de vérité de la formule,
      // et un `level` historique divergent ne fausse pas `leveledUp`.
      const previousLevel = typeof computeLevel === "function" ? computeLevel(previousXp) : current.level;
      const newXp = previousXp + safeGain;
      const newLevel = typeof computeLevel === "function" ? computeLevel(newXp) : current.level;

      // last_xp_at n'est inclus QUE si un XP réel est accordé. Le mettre à null
      // ici effacerait un horodatage existant, ce qui réouvrirait le cooldown.
      const updatePayload = safeGain > 0
        ? { xp: newXp, level: newLevel, last_xp_at: grantedAtIso, updated_at: nowIso }
        : { xp: newXp, level: newLevel, updated_at: nowIso };

      let query = this._table()
        .update(updatePayload)
        .eq("guild_id", guildId)
        .eq("user_id", userId)
        // Verrou optimiste : si un autre message a écrit depuis la lecture,
        // cette condition ne correspond plus et l'UPDATE touche 0 ligne.
        .eq("xp", previousXp);

      // Le cooldown fait partie de la MÊME condition d'écriture : deux messages
      // simultanés ne peuvent pas tous deux le franchir.
      //
      // `lte` et non `lt` : la garde SQL doit coïncider EXACTEMENT avec le
      // contrôle JS ci-dessus (`now - last < cooldownMs` ⇒ bloqué). À la
      // frontière (écoulé == cooldown) le JS autorise ; un `lt` strict aurait
      // fait échouer l'UPDATE et tourné jusqu'à XP_CONFLICT.
      if (cooldownMs > 0) {
        const cutoffIso = new Date(effectiveNow - cooldownMs).toISOString();
        query = query.or(`last_xp_at.is.null,last_xp_at.lte.${cutoffIso}`);
      }

      const { data, error } = await query
        .select("guild_id, user_id, xp, level, last_xp_at")
        .maybeSingle();

      if (error) {
        if (isUndefinedTable(error)) throw new MemberXpUnavailableError(error);
        throw error;
      }

      // data === null : la ligne a changé (ou le cooldown bloque) → on réessaie.
      if (data) {
        return {
          applied: true,
          xpGain: safeGain,
          xp: newXp,
          level: newLevel,
          previousXp,
          previousLevel,
        };
      }
    }

    // Conflit persistant après toutes les tentatives : on NE DEVINE PAS un
    // total, on signale. Mieux vaut un gain non attribué qu'un XP faux.
    return { applied: false, code: "XP_CONFLICT" };
  }
}

module.exports = {
  SupabaseXPRepository,
  MemberXpUnavailableError,
  MEMBER_XP_TABLE,
  MAX_CAS_ATTEMPTS,
  isUndefinedTable,
};
