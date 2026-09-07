"use strict";

/**
 * Dépôt Giveaways aligné sur le schéma Supabase RÉEL.
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
 * Il n'existe AUCUNE colonne prize ni message_id.
 *
 * Colonnes réelles de public.giveaway_entries (3, créées par M5, vérifiées) :
 *   giveaway_id bigint NOT NULL · user_id text NOT NULL
 *   created_at timestamptz NOT NULL default now()
 *   PK composite giveaway_entries_pkey (giveaway_id, user_id)
 *   Aucune FK : elle installerait des triggers RI sur giveaways, interdite de
 *   modification. Aucune colonne guild_id : elle dupliquerait giveaways.guild_id.
 *
 * CONVENTION : `duration` est stocké en MINUTES. `ends_at` porte l'échéance
 * absolue ; `duration` reste informatif.
 */

const { randomInt } = require("node:crypto");

/** Code d'erreur PostgREST « relation inexistante ». */
const UNDEFINED_TABLE = "42P01";

/** Code d'erreur Postgres « violation de contrainte d'unicité ». */
const UNIQUE_VIOLATION = "23505";

/**
 * Taille de lot de la pagination des participations.
 *
 * Un `select` sans `.range()` est plafonné silencieusement par le
 * `db-max-rows` de PostgREST (1000 par défaut) : au-delà, les participants
 * suivants disparaissaient du tirage SANS AUCUNE ERREUR. C'est exactement le
 * défaut corrigé en P10 sur les analytics, dont le modèle est repris ici.
 */
const ENTRIES_PAGE_SIZE = 1000;

/**
 * Plafond de participations lues pour un tirage (décision K5).
 *
 * Au-delà, `truncated` vaut true et le résultat est signalé comme partiel :
 * un total tronqué n'est JAMAIS présenté comme exact.
 */
const ENTRIES_SCAN_CAP = 50000;

/**
 * Erreur typée signalant que public.giveaway_entries est indisponible.
 *
 * La table existe depuis M5. Le garde-fou est CONSERVÉ à dessein : une
 * régression de schéma ou de droits doit rester distinguishable d'un échec
 * réel, et ne pas retomber dans un GIVEAWAY_JOIN_FAILED muet.
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
 * 4G-5 — Erreur typée : le giveaway n'appartient pas à la guilde demandée.
 *
 * Levée par le DÉPÔT, pas par le service. Le service conserve sa propre garde
 * `giveaway.guild_id !== guildId` ; celle-ci est le second rempart, celui qui
 * tient même si un futur appelant oublie la première.
 */
class GiveawayNotInGuildError extends Error {
  constructor(guildId, giveawayId) {
    super(`giveaway ${giveawayId} is not in guild ${guildId}`);
    this.name = "GiveawayNotInGuildError";
    this.code = "GIVEAWAY_NOT_IN_GUILD";
  }
}

/**
 * Détecte l'absence de la table giveaway_entries.
 *
 * Le code PostgREST 42P01 est le SEUL signal fiable. Classifier sur le texte du
 * message ferait passer un refus de permission (42501) sur giveaway_entries
 * pour une table absente. Le repli textuel n'est conservé que si le client ne
 * fournit AUCUN code, et exige alors la formulation Postgres exacte.
 */
function isUndefinedTable(error) {
  if (!error) return false;
  if (error.code) return error.code === UNDEFINED_TABLE;
  return /relation "[^"]*" does not exist/i.test(String(error.message || ""));
}

/**
 * Mélange Fisher–Yates, tirage par crypto.randomInt (décision K2).
 *
 * L'ancien `[...entries].sort(() => Math.random() - 0.5)` n'est pas un mélange
 * uniforme : mesuré sur 200 000 tirages à 5 participants, le premier inscrit
 * gagnait 32,41 % des tirages contre 12,31 % pour un autre — un écart de 2,63×
 * alors que l'équité impose 20 % chacun. Un comparateur aléatoire viole la
 * relation d'ordre total attendue par sort(), qui ne produit alors aucune
 * permutation équiprobable.
 *
 * crypto.randomInt remplace Math.random : non seulement le mélange devient
 * équiprobable, mais il n'est plus prévisible par un participant qui
 * observerait les tirages précédents.
 */
function shuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    const tmp = result[i];
    result[i] = result[j];
    result[j] = tmp;
  }
  return result;
}

/**
 * Nombre de gagnants à tirer.
 *
 * `giveaways.winners_count` est nullable, défaut réel 1. Une valeur absente,
 * nulle, négative ou non entière retombe sur 1 — le défaut de la colonne.
 * L'ancien `giveaway.winners_count ? giveaway.winners_count : 1` obtenait le
 * même résultat par accident : `0` est falsy. Le comportement est désormais
 * explicite plutôt que le sous-produit d'une coercion.
 */
function resolveWinnersCount(winnersCount) {
  const value = Number(winnersCount);
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : 1;
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
    // 4G-5 — fail-closed : sans guilde, on n'insère rien. `guild_id` est
    // NOT NULL, mais laisser Postgres refuser la ligne produirait un
    // GIVEAWAY_CREATE_FAILED qui ne nomme pas la cause.
    if (!guildId || typeof guildId !== "string") {
      throw new TypeError("SupabaseGiveawayRepository.create requires a guildId");
    }
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

  // ───────────────────────────────────────────────────────────────────────
  // 4G-5 — lecture scopée par guilde.
  //
  // Avant, seul `id` filtrait : la requête traversait les guildes et le
  // cloisonnement reposait uniquement sur `giveaway.guild_id !== guildId`
  // dans GiveawayService. C'est exactement le défaut corrigé en 4G sur
  // tickets : la faiblesse est structurelle, et un appelant qui oublie la
  // garde applicative n'a plus aucun rempart.
  //
  // Fail-closed : sans guilde, aucune requête n'est émise.
  // ───────────────────────────────────────────────────────────────────────
  async findById(guildId, id) {
    if (!guildId || id === undefined || id === null || id === "") return null;
    const { data, error } = await this.supabase
      .from("giveaways").select("*").eq("guild_id", guildId).eq("id", id).maybeSingle();
    if (error) throw error;
    return data;
  }

  /**
   * 4G-5 — prouve en BASE que le giveaway appartient à la guilde.
   *
   * Nécessaire pour `giveaway_entries`, qui n'a AUCUNE colonne guild_id et
   * AUCUNE FK vers giveaways (décision M5 : une FK installerait des triggers
   * d'intégrité référentielle sur giveaways). Sans FK, PostgREST ne peut pas
   * faire d'embedding de ressource : `.select("*, giveaways!inner(guild_id)")`
   * échouerait. Ajouter une colonne guild_id à la table enfant est exclu
   * (aucun changement de schéma).
   *
   * Reste donc la seule option qui garantisse le cloisonnement EN BASE :
   * vérifier la parenté par une requête scopée avant toute opération sur
   * l'enfant. Ce n'est pas une validation côté service — c'est le dépôt qui
   * interroge la base et refuse.
   *
   * @returns {object} la ligne parente, pour éviter une relecture inutile.
   */
  async #requireGiveawayInGuild(guildId, giveawayId) {
    const parent = await this.findById(guildId, giveawayId);
    if (!parent) throw new GiveawayNotInGuildError(guildId, giveawayId);
    return parent;
  }

  /**
   * Inscrit un participant.
   *
   * L'unicité est portée par la PK composite (giveaway_id, user_id) créée par
   * M5. Deux clics Join simultanés : le second INSERT échoue en 23505 et est
   * traduit en `alreadyJoined` plutôt que de remonter comme erreur brute.
   *
   * Sans cette contrainte en base, le 23505 n'arriverait jamais et un membre
   * pourrait inscrire autant de lignes qu'il veut — gonflant ses chances au
   * tirage sans qu'aucune erreur n'apparaisse.
   *
   * Le 23505 n'est traduit QUE sur l'insert : sur un update il signalerait
   * autre chose et doit remonter.
   */
  async join(guildId, giveawayId, userId) {
    if (giveawayId === undefined || giveawayId === null || giveawayId === "") {
      throw new TypeError("SupabaseGiveawayRepository.join requires a giveawayId");
    }
    if (!userId || typeof userId !== "string") {
      throw new TypeError("SupabaseGiveawayRepository.join requires a userId");
    }
    // 4G-5 — la table enfant n'a pas de guild_id : la parenté est prouvée en
    // base avant l'INSERT, sinon un client modifié pourrait inscrire une ligne
    // sur le giveaway d'une autre guilde et gonfler ses chances au tirage.
    await this.#requireGiveawayInGuild(guildId, giveawayId);
    const { data, error } = await this.supabase
      .from("giveaway_entries").insert({ giveaway_id: giveawayId, user_id: userId })
      .select().single();
    if (error) {
      if (isUndefinedTable(error)) throw new GiveawayEntriesUnavailableError(error);
      if (error.code === UNIQUE_VIOLATION) return { alreadyJoined: true };
      throw error;
    }
    return { alreadyJoined: false, entry: data };
  }

  /**
   * Liste les participations d'un giveaway, par pagination bornée.
   *
   * Renvoie { entries, total, truncated } :
   *   • entries   — lignes lées, { user_id } ;
   *   • total     — nombre EXACT de lignes effectivement lues ;
   *   • truncated — true si le plafond ENTRIES_SCAN_CAP a été atteint, auquel
   *                 cas `total` est un PLANCHER et non le vrai total.
   *
   * L'ordre est imposé par created_at puis user_id : sans ORDER BY, Postgres ne
   * garantit aucun ordre stable d'une page à l'autre, et une pagination sur un
   * ordre instable peut sauter ou dupliquer des lignes.
   */
  async listEntries(guildId, giveawayId) {
    // 4G-5 — même garantie que join() : la parenté est prouvée en base avant
    // de lire les participations d'un giveaway qui pourrait appartenir à une
    // autre guilde.
    await this.#requireGiveawayInGuild(guildId, giveawayId);
    const entries = [];
    let truncated = false;
    for (let from = 0; ; from += ENTRIES_PAGE_SIZE) {
      if (entries.length >= ENTRIES_SCAN_CAP) {
        truncated = true;
        break;
      }
      const { data, error } = await this.supabase
        .from("giveaway_entries")
        .select("user_id")
        .eq("giveaway_id", giveawayId)
        .order("created_at", { ascending: true })
        .order("user_id", { ascending: true })
        .range(from, from + ENTRIES_PAGE_SIZE - 1);
      if (error) {
        if (isUndefinedTable(error)) throw new GiveawayEntriesUnavailableError(error);
        throw error;
      }
      const rows = data || [];
      if (rows.length === 0) break;
      for (const row of rows) entries.push(row);
      if (rows.length < ENTRIES_PAGE_SIZE) break;
    }
    return { entries, total: entries.length, truncated };
  }

  /**
   * Tire les gagnants au sort.
   *
   * Ne vérifie PAS l'état du giveaway et ne le clôture PAS : la garde
   * anti-double-tirage appartient au service, via closeIfActive().
   *
   * @param {number} winnersCount  Gagnants demandés. S'il y a moins de
   *   participants, tous les disponibles sont tirés (décision K3).
   * @returns {{winners: string[], entriesTotal: number, truncated: boolean}}
   */
  async draw(guildId, giveawayId, { winnersCount } = {}) {
    // 4G-5 — listEntries prouve déjà la parenté en base ; draw ne fait que
    // transmettre la guilde.
    const { entries, total, truncated } = await this.listEntries(guildId, giveawayId);
    if (!entries.length) return { winners: [], entriesTotal: 0, truncated };
    const count = resolveWinnersCount(winnersCount);
    // slice() borne déjà au nombre de participants : participants < winnersCount
    // renvoie simplement tous les disponibles, sans erreur ni gagnant fantôme.
    const winners = shuffle(entries).slice(0, count).map((entry) => entry.user_id);
    return { winners, entriesTotal: total, truncated };
  }

  /**
   * Clôture un giveaway SEULEMENT s'il est encore ouvert.
   *
   * L'update conditionnel `.eq("active", true)` agit comme un compare-and-swap
   * côté Postgres : si deux /giveaway draw concurrents arrivent, un seul obtient
   * une ligne et l'autre reçoit 0 ligne. C'est ce qui rend la garde
   * anti-double-tirage atomique SANS AUCUN RPC.
   *
   * L'ancien close() posait active=false sans condition et le service l'appelait
   * dans un `.catch(() => {})` : un échec de clôture laissait active à true,
   * donc le giveaway restait tirable indéfiniment et l'échec était invisible.
   *
   * Pose les TROIS champs réels de clôture :
   *   • active  = false  → fait autorité sur l'état ouvert/fermé ;
   *   • status  = 'ended'→ valeur cible retenue. ⚠️ DÉCISION DE CONCEPTION :
   *                        aucun CHECK ni jeu de valeurs historique vérifié en
   *                        base, la table étant vide. Le défaut réel est 'active'.
   *   • ended_at = now() → colonne réelle.
   *
   * @returns {Promise<boolean>} true si la clôture a eu lieu, false si le
   *   giveaway était déjà clos. Une erreur réelle est propagée, jamais avalée.
   */
  async closeIfActive(guildId, giveawayId) {
    // 4G-5 — l'UPDATE est scopé par guilde DANS la requête. Le CAS
    // `.eq("active", true)` est conservé tel quel : il porte l'atomicité
    // anti-double-tirage, il ne portait pas le cloisonnement.
    if (!guildId || giveawayId === undefined || giveawayId === null || giveawayId === "") {
      throw new TypeError("SupabaseGiveawayRepository.closeIfActive requires a guildId and a giveawayId");
    }
    const record = { active: false, status: "ended", ended_at: new Date().toISOString() };
    const { data, error } = await this.supabase
      .from("giveaways").update(record)
      .eq("guild_id", guildId).eq("id", giveawayId).eq("active", true).select();
    if (error) throw error;
    return Array.isArray(data) ? data.length > 0 : Boolean(data);
  }
}

module.exports = {
  SupabaseGiveawayRepository,
  GiveawayEntriesUnavailableError,
  GiveawayNotInGuildError,
  ENTRIES_PAGE_SIZE,
  ENTRIES_SCAN_CAP,
};
