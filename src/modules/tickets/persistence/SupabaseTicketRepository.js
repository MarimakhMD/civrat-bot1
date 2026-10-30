"use strict";

const { TicketRepository } = require("./TicketRepository");
const { toPersistenceError } = require("../../../adapters/supabase/supabaseErrorClassifier");

// ─────────────────────────────────────────────────────────────────────────
// 4G C5 — projection minimale.
//
// Les deux lectures utilisaient select("*"), qui renvoyait la ligne entière
// (id, category, closed_at, created_at, panel_id…) alors que le code métier ne
// lit que cinq colonnes. Réduire la projection limite ce qui transite et ce
// qu'un log pourrait capturer accidentellement.
//
// Les colonnes ÉCRITES (category, panel_id, closed_at…) ne sont pas concernées :
// une projection ne restreint que le RETURNING, jamais l'INSERT ni l'UPDATE.
// Aucun consommateur ne lit details.ticket (vérifié : 0 lecteur en prod, 0
// assertion de test sur ses champs).
// ─────────────────────────────────────────────────────────────────────────
const TICKET_COLUMNS = "guild_id, user_id, channel_id, status, closed";
const SNAPSHOT_COLUMNS = "free_category_id, free_category_name, free_destination_id, free_support_role_ids, free_permission_profile, free_welcome_message, free_open_limit";
const SNAPSHOT_KEYS = Object.freeze(SNAPSHOT_COLUMNS.split(", "));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SNOWFLAKE = /^\d{15,22}$/;

class SupabaseTicketRepository extends TicketRepository {
  constructor({ supabase, snapshotColumns = false }) {
    super();
    this.supabase = supabase;
    // "auto" ne rétrograde que les lectures historiques si une colonne manque ;
    // la création UUID exige toujours la RPC et ne rétrograde jamais.
    this.snapshotColumns = snapshotColumns === true || snapshotColumns === "auto";
    this.autoSnapshotColumns = snapshotColumns === "auto";
  }
  get columns() { return this.snapshotColumns ? `${TICKET_COLUMNS}, ${SNAPSHOT_COLUMNS}` : TICKET_COLUMNS; }

  async createWithSnapshot(record, snapshot) {
    if (!this.snapshotColumns) throw new Error("ticket_snapshot_storage_not_enabled");
    const roleIds = snapshot?.supportRoleIds;
    if (!record?.guild_id || !UUID.test(snapshot?.categoryId || "") || typeof snapshot?.categoryName !== "string" || !snapshot.categoryName.trim() || snapshot.categoryName.length > 80 || !SNOWFLAKE.test(snapshot?.destinationId || "") || !Array.isArray(roleIds) || !roleIds.length || roleIds.length > 5 || roleIds.some((id) => typeof id !== "string" || !SNOWFLAKE.test(id) || id === record.guild_id) || new Set(roleIds).size !== roleIds.length) throw new TypeError("invalid_ticket_snapshot");
    return this.create({ ...record, free_category_id: snapshot.categoryId, free_category_name: snapshot.categoryName.trim(), free_destination_id: snapshot.destinationId, free_support_role_ids: [...roleIds], free_permission_profile: "standard-v1", free_welcome_message: snapshot.welcomeMessage ?? null, free_open_limit: snapshot.openLimit ?? null });
  }

  async listOpenForUser(guildId, userId) {
    const { data, error } = await this.supabase.from("tickets").select(this.columns).eq("guild_id", guildId).eq("user_id", userId).in("status", ["open","claimed"]);
    if (error) throw toPersistenceError(error, { operation: "listOpenForUser", resource: "tickets" });
    return data || [];
  }
  async listOpenForUserByCategory(guildId, userId, categoryId) {
    const { data, error } = await this.supabase.from("tickets").select(this.columns).eq("guild_id", guildId).eq("user_id", userId).eq("free_category_id", categoryId).in("status", ["open","claimed"]);
    if (error) throw toPersistenceError(error, { operation: "listOpenForUserByCategory", resource: "tickets" });
    return data || [];
  }
  async findOpen(guildId, userId) {
    const { data, error } = await this.supabase.from("tickets").select(TICKET_COLUMNS).eq("guild_id", guildId).eq("user_id", userId).in("status", ["open", "claimed"]).maybeSingle();
    // 4F-2c — erreur PostgREST classifiée (42501 RLS, 42P01/42703 schéma, réseau).
    if (error) throw toPersistenceError(error, { operation: "findOpen", resource: "tickets" });
    return data;
  }

  // ───────────────────────────────────────────────────────────────────────
  // 4G C2 — lecture scopée par guilde.
  //
  // Avant, seul channel_id filtrait : la requête traversait les guildes et le
  // cloisonnement reposait uniquement sur la vérification
  // `ticket.guild_id !== guildId` effectuée ensuite par TicketService. Les
  // snowflakes Discord étant globalement uniques, l'exploitation pratique était
  // improbable — la faiblesse était structurelle, pas exploitable via Discord.
  //
  // Le filtre est désormais DANS la requête : defense in depth. La garde
  // applicative est conservée, elle n'est pas remplacée.
  //
  // Fail-closed : sans guilde ni salon, on ne requête pas, on renvoie null.
  // ───────────────────────────────────────────────────────────────────────
  async findByChannel(guildId, channelId) {
    if (!guildId || !channelId) return null;
    let { data, error } = await this.supabase.from("tickets").select(this.columns).eq("guild_id", guildId).eq("channel_id", channelId).maybeSingle();
    // Compatibilité historique : uniquement une colonne inexistante permet
    // cette lecture restreinte ; toute autre erreur reste bloquante.
    if (this.autoSnapshotColumns && error?.code === "42703") {
      ({ data, error } = await this.supabase.from("tickets").select(TICKET_COLUMNS).eq("guild_id", guildId).eq("channel_id", channelId).maybeSingle());
      if (data && !error) Object.defineProperty(data, "_snapshot_schema_missing", { value: true, enumerable: false });
    }
    // 4F-2c — erreur PostgREST classifiée.
    if (error) throw toPersistenceError(error, { operation: "findByChannel", resource: "tickets" });
    return data;
  }

  // Informations disponibles pour l'examen, jamais utilisées pour déduire
  // les rôles d'origine (le panneau et sa configuration sont mutables).
  async findForHistoricalReview(guildId, channelId) {
    if (!guildId || !channelId) return null;
    const { data, error } = await this.supabase.from("tickets").select(`${this.columns}, panel_id, created_at`).eq("guild_id", guildId).eq("channel_id", channelId).maybeSingle();
    if (error?.code === "42703") return this.findByChannel(guildId, channelId);
    if (error) throw toPersistenceError(error, { operation: "findHistoricalReview", resource: "tickets" });
    return data;
  }

  async create(record) {
    const { data, error } = await this.supabase.from("tickets").insert(record).select(Object.hasOwn(record, "free_category_id") ? this.columns : TICKET_COLUMNS).single();
    // 4F-2c — anti-double-ouverture : le 23505 (index unique partiel
    // idx_tickets_open_unique) DOIT remonter avec son code brut, car
    // TicketService lit `error.code === "23505"` pour répondre
    // OPEN_TICKET_EXISTS et déclencher le rollback `unique_violation`.
    // Toute autre erreur est classifiée (42501 RLS, 42P01/42703 schéma,
    // réseau → BackendUnavailableError).
    if (error?.code === "23505") throw error;
    if (error) throw toPersistenceError(error, { operation: "create", resource: "tickets" });
    return data;
  }

  // RPC transactionnelle proposée : verrou commun avec archivage, comparaison
  // de la configuration et INSERT de la ligne et de l'instantané ensemble.
  async createCategoryTicket(record, snapshot, welcomeMessage) {
    if (!this.snapshotColumns || !this.supabase?.rpc) throw new Error("ticket_snapshot_storage_not_enabled");
    const roles = snapshot?.supportRoleIds;
    if (!record?.guild_id || !record?.user_id || !record?.channel_id || !UUID.test(snapshot?.categoryId || "") || typeof snapshot.categoryName !== "string" || !snapshot.categoryName.trim() || snapshot.categoryName.length > 80 || !SNOWFLAKE.test(snapshot.destinationId || "") || !Array.isArray(roles) || !roles.length || roles.length > 5 || roles.some((id) => typeof id !== "string" || !SNOWFLAKE.test(id) || id === record.guild_id) || new Set(roles).size !== roles.length) throw new TypeError("invalid_ticket_snapshot");
    const { data, error } = await this.supabase.rpc("civrat_ticket_free_create_snapshot", {
      p_guild_id: record.guild_id, p_user_id: record.user_id, p_channel_id: record.channel_id,
      p_panel_id: record.panel_id, p_category_id: snapshot.categoryId, p_name: snapshot.categoryName,
      p_destination_id: snapshot.destinationId, p_role_ids: roles, p_welcome_message: welcomeMessage ?? null, p_open_limit: snapshot.openLimit ?? null,
    });
    if (error?.code === "23505") throw error;
    if (error) throw toPersistenceError(error, { operation: "createCategoryTicket", resource: "rpc.civrat_ticket_free_create_snapshot" });
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || row.guild_id !== record.guild_id || row.channel_id !== record.channel_id || row.free_category_id !== snapshot.categoryId || row.free_category_name !== snapshot.categoryName || row.free_destination_id !== snapshot.destinationId || row.free_permission_profile !== "standard-v1" || row.free_welcome_message !== (welcomeMessage ?? null) || row.free_open_limit !== (snapshot.openLimit ?? null) || !Array.isArray(row.free_support_role_ids) || JSON.stringify(row.free_support_role_ids) !== JSON.stringify(roles)) throw new Error("ticket_snapshot_unconfirmed");
    return row;
  }

  // ───────────────────────────────────────────────────────────────────────
  // 4G C2 — écriture scopée par guilde.
  //
  // Avant, seul channel_id filtrait l'UPDATE : la requête traversait les
  // guildes. Les quatre appelants de TicketService vérifiaient déjà
  // `ticket.guild_id !== guildId` après lecture, donc l'exploitation pratique
  // exigeait de contourner cette garde — la faiblesse était structurelle.
  //
  // Le filtre est désormais DANS la requête, comme pour findByChannel :
  // defense in depth. Les gardes applicatives de TicketService sont
  // CONSERVÉES, pas remplacées.
  //
  // Fail-closed : sans guilde ni salon, on n'émet AUCUNE requête. On lève
  // une TypeError plutôt que de renvoyer null — un UPDATE qui « réussit »
  // sans rien faire serait pire qu'un échec. Les quatre appelants sont dans
  // un try/catch qui renvoie TICKET_*_FAILED.
  // ───────────────────────────────────────────────────────────────────────
  async updateByChannel(guildId, channelId, updates) {
    if (!guildId || !channelId) {
      throw new TypeError("SupabaseTicketRepository.updateByChannel requires guildId and channelId");
    }
    if (SNAPSHOT_KEYS.some((key) => Object.hasOwn(updates || {}, key))) throw new TypeError("ticket_snapshot_immutable");
    const { data, error } = await this.supabase.from("tickets").update(updates).eq("guild_id", guildId).eq("channel_id", channelId).select(TICKET_COLUMNS).single();
    // 4F-2c — erreur PostgREST classifiée. Un `.single()` sur 0 ligne (PGRST116,
    // cross-guild) devient PERSISTENCE_FAILED ; le 23505 sur un update reste
    // classifié en PERSISTENCE_CONFLICT (jamais traduit en OPEN_TICKET_EXISTS,
    // conformément au contrat documenté dans TicketService).
    if (error) throw toPersistenceError(error, { operation: "updateByChannel", resource: "tickets" });
    return data;
  }

  async updateTicketRecord(guildId, channelId, updates) { return this.updateByChannel(guildId, channelId, updates); }
}

module.exports = { SupabaseTicketRepository, TICKET_COLUMNS, SNAPSHOT_COLUMNS };
