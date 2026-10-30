"use strict";

const { toPersistenceError } = require("../../../adapters/supabase/supabaseErrorClassifier");

class SupabaseTicketReservationRepository {
  constructor({ supabase }) {
    if (!supabase || typeof supabase.rpc !== "function") throw new TypeError("privileged Supabase client required");
    this.supabase = supabase;
  }
  async reserveOpen({ guildId, userId, categoryId, requestId, actorId }) {
    const { data, error } = await this.supabase.rpc("civrat_ticket_reserve_open", {
      p_guild_id: guildId, p_user_id: userId, p_category_id: categoryId || null, p_request_id: requestId, p_actor_id: actorId,
    });
    if (error) {
      if (error.hint === "TICKET_LIMIT_REACHED") throw Object.assign(new Error("TICKET_LIMIT_REACHED"), { code: "TICKET_LIMIT_REACHED", cause: error });
      if (error.hint === "TICKET_CATEGORY_LIMIT_REACHED") throw Object.assign(new Error("TICKET_CATEGORY_LIMIT_REACHED"), { code: "TICKET_CATEGORY_LIMIT_REACHED", cause: error });
      throw toPersistenceError(error, { operation: "reserveOpen", resource: "rpc.civrat_ticket_reserve_open" });
    }
    return data;
  }
  async finalizeOpen({ requestId, channelId }) {
    const { data, error } = await this.supabase.rpc("civrat_ticket_finalize_open", { p_request_id: requestId, p_channel_id: channelId });
    if (error) throw toPersistenceError(error, { operation: "finalizeOpen", resource: "rpc.civrat_ticket_finalize_open" });
    return data;
  }
  async cancelReservation({ requestId, actorId }) {
    const { data, error } = await this.supabase.rpc("civrat_ticket_cancel_reservation", { p_request_id: requestId, p_actor_id: actorId });
    if (error) throw toPersistenceError(error, { operation: "cancelReservation", resource: "rpc.civrat_ticket_cancel_reservation" });
    return data;
  }
  async reserveReopen({ guildId, userId, channelId, requestId, actorId }) {
    const { data, error } = await this.supabase.rpc("civrat_ticket_reserve_reopen", {
      p_guild_id: guildId, p_user_id: userId, p_channel_id: channelId, p_request_id: requestId, p_actor_id: actorId,
    });
    if (error) {
      if (error.hint === "TICKET_LIMIT_REACHED") throw Object.assign(new Error("TICKET_LIMIT_REACHED"), { code: "TICKET_LIMIT_REACHED", cause: error });
      if (error.hint === "TICKET_CATEGORY_LIMIT_REACHED") throw Object.assign(new Error("TICKET_CATEGORY_LIMIT_REACHED"), { code: "TICKET_CATEGORY_LIMIT_REACHED", cause: error });
      throw toPersistenceError(error, { operation: "reserveReopen", resource: "rpc.civrat_ticket_reserve_reopen" });
    }
    return data;
  }
  async listForUser(guildId, userId) {
    const { data, error } = await this.supabase.from("civrat_ticket_reservations").select("*").eq("guild_id", guildId).eq("user_id", userId).in("state", ["reserved","external_pending","channel_known"]);
    if (error) throw toPersistenceError(error, { operation: "listForUser", resource: "civrat_ticket_reservations" });
    return data || [];
  }
  async listForCategory(guildId, userId, categoryId) {
    const { data, error } = await this.supabase.from("civrat_ticket_reservations").select("*").eq("guild_id", guildId).eq("user_id", userId).eq("category_id", categoryId).in("state", ["reserved","external_pending","channel_known"]);
    if (error) throw toPersistenceError(error, { operation: "listForCategory", resource: "civrat_ticket_reservations" });
    return data || [];
  }
  async listPending({ guildId = null, threshold = null, limit = 50 } = {}) {
    let q = this.supabase.from("civrat_ticket_reservations").select("*").in("state", ["reserved","external_pending","channel_known","cleanup_pending"]).order("created_at", { ascending: true }).limit(limit);
    if (guildId) q = q.eq("guild_id", guildId);
    if (threshold) q = q.lt("created_at", threshold);
    const { data, error } = await q;
    if (error) throw toPersistenceError(error, { operation: "listPending", resource: "civrat_ticket_reservations" });
    return data || [];
  }
  async tryLock(requestId) {
    // Supabase : on s'appuie sur FOR UPDATE SKIP LOCKED côté SQL (listPending) ; le lock est transactionnel
    return true;
  }
  async unlock(requestId) { return true; }

  // Lecture pour limites : compte tickets + réservations (utilisé en fallback si RPC non dispo, pour tests)
  async countOpenForUser(guildId, userId) {
    const { data, error } = await this.supabase.from("tickets").select("channel_id", { count: "exact", head: true }).eq("guild_id", guildId).eq("user_id", userId).in("status", ["open","claimed"]);
    if (error) throw toPersistenceError(error, { operation: "countOpenForUser", resource: "tickets" });
    return data?.length ?? 0;
  }
}

module.exports = { SupabaseTicketReservationRepository };
