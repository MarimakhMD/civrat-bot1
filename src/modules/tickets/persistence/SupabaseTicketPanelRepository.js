"use strict";

const {
  TicketPanelRepository,
  toDomainPanel,
  normalizeButtons,
} = require("./TicketPanelRepository");
const { MAX_PANELS_PER_GUILD } = require("../configuration/ticketConstants");

/**
 * M8 — Dépôt des panels de tickets sur public.ticket_panels (Supabase).
 *
 * Le client doit être PRIVILÉGIÉ (supabaseAdmin) : la RLS de public.ticket_panels
 * n'accorde aucun droit à anon/authenticated, et seul service_role possède
 * SELECT + INSERT + UPDATE. Un client non privilégié échouerait en 42501.
 *
 * ⚠️ Le reste du module tickets utilise le client NON privilégié `supabase`
 *    (createGuildSettingsRuntime.js), parce que public.tickets porte encore la
 *    policy `public / ALL`. Ce dépôt est volontairement différent : il suit la
 *    convention B1/B2/B3, pas celle du module.
 *
 * AUCUN DELETE : désactiver un panel pose is_active = false. La base ne concède
 * d'ailleurs pas DELETE à service_role.
 *
 * AUCUNE RPC : toutes les opérations sont mono-ligne par PK. Il n'y a ni
 * agrégation (contrairement au leaderboard B2), ni compteur à incrémenter
 * (contrairement à increment_ticket_counter M7) — `identity` est atomique.
 *
 * ⚠️ `id` est un bigint : PostgREST le renvoie en CHAÎNE. Il est conservé tel
 *    quel et comparé en string.
 */
const TICKET_PANELS_TABLE = "ticket_panels";

/** Code PostgREST « undefined_table ». */
const UNDEFINED_TABLE = "42P01";

const PANEL_COLUMNS = "id, guild_id, channel_id, message_id, category_id, support_role_id, buttons, is_active, created_at, updated_at";

/** Erreur typée : la table ticket_panels est indisponible (migration non appliquée). */
class TicketPanelsUnavailableError extends Error {
  constructor(cause) {
    super("public.ticket_panels is unavailable (migration M8 not applied)");
    this.name = "TicketPanelsUnavailableError";
    this.code = "TICKET_PANELS_UNAVAILABLE";
    this.cause = cause;
  }
}

/**
 * Le code 42P01 est le SEUL signal fiable : classifier sur le texte du message
 * ferait passer un refus de permission (42501) pour une table absente.
 * Convention reprise de M5, M4, B3, B1 et B2.
 */
function isUndefinedTable(error) {
  return Boolean(error) && error.code === UNDEFINED_TABLE;
}

class SupabaseTicketPanelRepository extends TicketPanelRepository {
  /**
   * @param {object} options
   * @param {object} options.supabase Client PRIVILÉGIÉ (supabaseAdmin).
   */
  constructor({ supabase } = {}) {
    super();
    if (!supabase || typeof supabase.from !== "function") {
      throw new TypeError("SupabaseTicketPanelRepository requires a supabase client");
    }
    this.supabase = supabase;
  }

  _table() {
    return this.supabase.from(TICKET_PANELS_TABLE);
  }

  _wrap(error) {
    if (isUndefinedTable(error)) throw new TicketPanelsUnavailableError(error);
    throw error;
  }

  /**
   * Crée un panel. UNE écriture.
   *
   * `created_at` / `updated_at` ne sont PAS fournis : les colonnes portent
   * DEFAULT now(), c'est la base qui fait foi (convention warnings B1,
   * invite_links B2, member_xp B3).
   */
  async create({ guildId, channelId, messageId, categoryId, supportRoleId, buttons = [] } = {}) {
    if (!guildId || !channelId || !messageId || !categoryId || !supportRoleId) {
      throw new TypeError("SupabaseTicketPanelRepository.create requires guildId, channelId, messageId, categoryId and supportRoleId");
    }

    const { data, error } = await this._table()
      .insert({
        guild_id: String(guildId),
        channel_id: String(channelId),
        message_id: String(messageId),
        category_id: String(categoryId),
        support_role_id: String(supportRoleId),
        buttons: normalizeButtons(buttons),
      })
      .select(PANEL_COLUMNS)
      .single();

    if (error) this._wrap(error);
    return toDomainPanel(data);
  }

  async findActive(guildId, panelId) {
    if (!guildId || panelId === undefined || panelId === null || panelId === "") return null;

    const { data, error } = await this._table()
      .select(PANEL_COLUMNS)
      .eq("guild_id", String(guildId))
      // Comparaison en STRING : id est un bigint renvoyé en chaîne.
      .eq("id", String(panelId))
      .eq("is_active", true)
      .maybeSingle();

    if (error) this._wrap(error);
    return toDomainPanel(data);
  }

  async listActive(guildId) {
    if (!guildId) return [];

    const { data, error } = await this._table()
      .select(PANEL_COLUMNS)
      .eq("guild_id", String(guildId))
      .eq("is_active", true)
      // id est un bigint : le tri est demandé à la base, qui trie numériquement.
      .order("id", { ascending: true });

    if (error) this._wrap(error);
    return (Array.isArray(data) ? data : []).map(toDomainPanel);
  }

  /**
   * Compte EXACT les panels actifs d'une guilde.
   *
   * HEAD + Prefer: count=exact (technique éprouvée en P10 puis M4, B2) : le
   * total arrive dans Content-Range, aucune ligne n'est transférée. Insensible
   * à db-max-rows.
   */
  async countActive(guildId) {
    if (!guildId) return 0;

    const { count, error } = await this._table()
      .select("id", { count: "exact", head: true })
      .eq("guild_id", String(guildId))
      .eq("is_active", true);

    if (error) this._wrap(error);
    const total = Number(count);
    return Number.isFinite(total) && total > 0 ? total : 0;
  }

  /** Le plafond validé : 10 panels actifs par guilde. */
  async canCreate(guildId) {
    return (await this.countActive(guildId)) < MAX_PANELS_PER_GUILD;
  }

  /**
   * Met à jour un panel actif.
   *
   * `.eq("is_active", true)` empêche de ressusciter un panel désactivé : une
   * édition qui arriverait après une désactivation ne matche aucune ligne.
   */
  async updatePanel(guildId, panelId, updates = {}) {
    if (!guildId || panelId === undefined || panelId === null || panelId === "") return null;

    const payload = {};
    if (updates.channelId !== undefined) payload.channel_id = String(updates.channelId);
    if (updates.messageId !== undefined) payload.message_id = String(updates.messageId);
    if (updates.categoryId !== undefined) payload.category_id = String(updates.categoryId);
    if (updates.supportRoleId !== undefined) payload.support_role_id = String(updates.supportRoleId);
    if (updates.buttons !== undefined) payload.buttons = normalizeButtons(updates.buttons);
    if (Object.keys(payload).length === 0) return this.findActive(guildId, panelId);

    const { data, error } = await this._table()
      .update(payload)
      .eq("guild_id", String(guildId))
      .eq("id", String(panelId))
      .eq("is_active", true)
      .select(PANEL_COLUMNS)
      .maybeSingle();

    if (error) this._wrap(error);
    return toDomainPanel(data);
  }

  /**
   * Désactive un panel : pose is_active = false, ne supprime JAMAIS la ligne.
   *
   * `.eq("is_active", true)` rend l'opération idempotente : un second appel ne
   * matche plus aucune ligne et renvoie deactivated:false sans effet.
   */
  async deactivate(guildId, panelId) {
    if (!guildId || panelId === undefined || panelId === null || panelId === "") {
      throw new TypeError("SupabaseTicketPanelRepository.deactivate requires guildId and panelId");
    }

    const { data, error } = await this._table()
      .update({ is_active: false })
      .eq("guild_id", String(guildId))
      .eq("id", String(panelId))
      .eq("is_active", true)
      .select("id");

    if (error) this._wrap(error);
    const rows = Array.isArray(data) ? data : [];
    return { deactivated: rows.length > 0, guildId: String(guildId), panelId: String(panelId) };
  }
}

module.exports = {
  SupabaseTicketPanelRepository,
  TicketPanelsUnavailableError,
  isUndefinedTable,
  TICKET_PANELS_TABLE,
  PANEL_COLUMNS,
};
