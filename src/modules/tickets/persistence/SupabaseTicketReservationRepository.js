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
  // Lecture pour limites : compte tickets + réservations (utilisé en fallback si RPC non dispo, pour tests)
  async countOpenForUser(guildId, userId) {
    const { data, error } = await this.supabase.from("tickets").select("channel_id", { count: "exact", head: true }).eq("guild_id", guildId).eq("user_id", userId).in("status", ["open","claimed"]);
    if (error) throw toPersistenceError(error, { operation: "countOpenForUser", resource: "tickets" });
    return data?.length ?? 0;
  }
}

module.exports = { SupabaseTicketReservationRepository };
