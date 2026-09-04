"use strict";

const { InviteStatsRepository } = require("./InviteStatsRepository");

/**
 * B2 — Dépôt des invitations sur public.invite_links (Supabase).
 *
 * Le client doit être PRIVILÉGIÉ (supabaseAdmin) : la RLS de public.invite_links
 * n'accorde aucun droit à anon/authenticated, et seul service_role possède
 * SELECT + INSERT + UPDATE.
 *
 * AUCUN compteur n'est stocké. Le nombre d'invitations d'un membre est un
 * COUNT(*) des liens actifs dont il est l'inviter. Il n'y a donc aucune valeur
 * à perdre : deux process peuvent écrire simultanément sans lost update.
 *
 * AUCUN DELETE : une révocation pose revoked_at. La base ne concède d'ailleurs
 * pas DELETE à service_role.
 *
 * AUCUNE mise à jour arbitraire : la seule écriture UPDATE est la révocation
 * (et la réactivation au retour d'un membre, portée par le même upsert).
 */
const INVITE_LINKS_TABLE = "invite_links";

/** Code PostgREST « undefined_table ». */
const UNDEFINED_TABLE = "42P01";

/** Colonnes réellement présentes dans public.invite_links (migration B2 vérifiée). */
const INVITE_LINK_COLUMNS = "guild_id, invited_id, inviter_id, invite_code, created_at, revoked_at";

/**
 * Plafond du classement. Aligné sur la RPC invite_leaderboard, qui borne déjà
 * avec LEAST(GREATEST(p_limit, 1), 100) : borner aussi côté client évite de
 * demander un travail que la base refusera de toute façon.
 */
const LEADERBOARD_DEFAULT_LIMIT = 10;
const LEADERBOARD_MAX_LIMIT = 100;

/** Erreur typée : la table invite_links est indisponible (migration non appliquée). */
class InviteLinksUnavailableError extends Error {
  constructor(cause) {
    super("public.invite_links is unavailable (migration B2 not applied)");
    this.name = "InviteLinksUnavailableError";
    this.code = "INVITE_LINKS_UNAVAILABLE";
    this.cause = cause;
  }
}

/**
 * Détecte l'absence de la table.
 *
 * Le code 42P01 est le SEUL signal fiable : classifier sur le texte du message
 * ferait passer un refus de permission (42501) pour une table absente.
 * Convention reprise de M5, M4, B3 et B1.
 */
function isUndefinedTable(error) {
  return Boolean(error) && error.code === UNDEFINED_TABLE;
}

/** Convertit une ligne (snake_case) vers le contrat du module (camelCase). */
function toDomainLink(row) {
  if (!row || typeof row !== "object") return null;
  return Object.freeze({
    guildId: row.guild_id,
    invitedId: row.invited_id,
    inviterId: row.inviter_id,
    inviteCode: row.invite_code === undefined ? null : row.invite_code,
    createdAt: row.created_at || null,
    revokedAt: row.revoked_at === undefined ? null : row.revoked_at,
  });
}

class SupabaseInviteStatsRepository extends InviteStatsRepository {
  /**
   * @param {object} options
   * @param {object} options.supabase Client PRIVILÉGIÉ (supabaseAdmin).
   */
  constructor({ supabase } = {}) {
    super();
    if (!supabase || typeof supabase.from !== "function") {
      throw new TypeError("SupabaseInviteStatsRepository requires a supabase client");
    }
    this.supabase = supabase;
  }

  _table() {
    return this.supabase.from(INVITE_LINKS_TABLE);
  }

  /**
   * Attribution : UNE écriture.
   *
   * `onConflict: "guild_id,invited_id"` rend l'opération idempotente — deux
   * guildMemberAdd simultanés pour le même membre produisent une seule ligne —
   * et réactive un lien révoqué, ce qui couvre le retour d'un membre.
   *
   * `revoked_at: null` est fourni EXPRESSÉMENT : un upsert ne réécrit que les
   * colonnes transmises, donc sans lui un membre revenu resterait marqué parti
   * et ne serait plus jamais compté.
   *
   * `created_at` n'est PAS fourni : la colonne porte DEFAULT now(), c'est la
   * base qui fait foi (même convention que warnings en B1 et member_xp en B3).
   * Un retour conserve donc la date de première attribution ; c'est updated_at,
   * posé par trigger, qui horodate le changement.
   */
  async attributeInvite({ guildId, invitedId, inviterId, inviteCode = null } = {}) {
    if (!guildId || !invitedId || !inviterId) {
      throw new TypeError("attributeInvite requires guildId, invitedId and inviterId");
    }

    const { data, error } = await this._table()
      .upsert(
        {
          guild_id: guildId,
          invited_id: invitedId,
          inviter_id: inviterId,
          invite_code: inviteCode === undefined ? null : inviteCode,
          revoked_at: null,
        },
        { onConflict: "guild_id,invited_id" },
      )
      .select(INVITE_LINK_COLUMNS)
      .single();

    if (error) {
      if (isUndefinedTable(error)) throw new InviteLinksUnavailableError(error);
      throw error;
    }
    return toDomainLink(data);
  }

  /**
   * Révocation au départ : pose revoked_at, ne supprime jamais la ligne.
   *
   * Le `.is("revoked_at", null)` rend l'opération idempotente : un second
   * départ ne matche plus aucune ligne et renvoie revoked:false sans effet.
   */
  async revokeInvite(guildId, invitedId) {
    if (!guildId || !invitedId) {
      throw new TypeError("revokeInvite requires guildId and invitedId");
    }

    const { data, error } = await this._table()
      .update({ revoked_at: new Date().toISOString() })
      .eq("guild_id", guildId)
      .eq("invited_id", invitedId)
      .is("revoked_at", null)
      .select(INVITE_LINK_COLUMNS);

    if (error) {
      if (isUndefinedTable(error)) throw new InviteLinksUnavailableError(error);
      throw error;
    }
    const rows = Array.isArray(data) ? data : [];
    return { revoked: rows.length > 0, guildId, invitedId };
  }

  /**
   * Compte EXACT les liens actifs d'un inviteur.
   *
   * Requête HEAD + Prefer: count=exact (technique éprouvée en P10 sur
   * analytics_events puis M4 sur suggestion_votes) : le total arrive dans
   * l'en-tête Content-Range et AUCUNE ligne n'est transférée. Insensible à
   * db-max-rows, donc exact même au-delà de 1000 invitations.
   */
  async _countActiveInvites(guildId, inviterId) {
    const { count, error } = await this._table()
      .select("invited_id", { count: "exact", head: true })
      .eq("guild_id", guildId)
      .eq("inviter_id", inviterId)
      .is("revoked_at", null);

    if (error) {
      if (isUndefinedTable(error)) throw new InviteLinksUnavailableError(error);
      throw error;
    }
    const total = Number(count);
    return Number.isFinite(total) && total > 0 ? total : 0;
  }

  async getInviteStats(userId, guildId) {
    if (!guildId || !userId) return { userId, guildId, current: 0, invitedBy: null };

    const current = await this._countActiveInvites(guildId, userId);

    // Le lien dont ce membre est l'INVITÉ, s'il est encore actif.
    const { data, error } = await this._table()
      .select("inviter_id")
      .eq("guild_id", guildId)
      .eq("invited_id", userId)
      .is("revoked_at", null)
      .maybeSingle();

    if (error) {
      if (isUndefinedTable(error)) throw new InviteLinksUnavailableError(error);
      throw error;
    }
    return { userId, guildId, current, invitedBy: data?.inviter_id || null };
  }

  /**
   * Classement via la RPC invite_leaderboard.
   *
   * PostgREST ne sait pas exprimer GROUP BY : sans cette fonction SQL en
   * lecture seule, il faudrait soit rapatrier toutes les lignes de la guilde
   * (et le plafond P10 tronquerait SILENCIEUSEMENT le classement), soit tenir
   * une seconde table de compteurs susceptible d'être lue périmée.
   *
   * La RPC renvoie (user_id, invites) ; on la remappe vers { userId, current },
   * la forme exacte que lisent déjà inviteView et AnalyticsService.getTopInvites.
   * Aucun consommateur n'est modifié.
   */
  async getLeaderboard(guildId, limit = LEADERBOARD_DEFAULT_LIMIT) {
    if (!guildId) return [];
    const bounded = Number.isFinite(limit) && limit > 0
      ? Math.min(Math.trunc(limit), LEADERBOARD_MAX_LIMIT)
      : LEADERBOARD_DEFAULT_LIMIT;

    const { data, error } = await this.supabase.rpc("invite_leaderboard", {
      p_guild_id: guildId,
      p_limit: bounded,
    });

    if (error) {
      if (isUndefinedTable(error)) throw new InviteLinksUnavailableError(error);
      throw error;
    }
    return (Array.isArray(data) ? data : []).map((row) => ({
      userId: row.user_id,
      current: Number(row.invites) || 0,
    }));
  }

  async findOne(guildId, userId) {
    const stats = await this.getInviteStats(userId, guildId);
    if (stats.current === 0 && !stats.invitedBy) return null;
    return stats;
  }
}

module.exports = {
  SupabaseInviteStatsRepository,
  InviteLinksUnavailableError,
  isUndefinedTable,
  toDomainLink,
  INVITE_LINKS_TABLE,
  INVITE_LINK_COLUMNS,
  LEADERBOARD_DEFAULT_LIMIT,
  LEADERBOARD_MAX_LIMIT,
};
