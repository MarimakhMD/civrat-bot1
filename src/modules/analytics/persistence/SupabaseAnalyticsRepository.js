"use strict";

class SupabaseAnalyticsRepository {
  constructor({ supabase }) {
    if (!supabase || typeof supabase.from !== "function") {
      throw new TypeError("SupabaseAnalyticsRepository requires a supabase client");
    }
    this.supabase = supabase;
  }

  async track(guildId, event) {
    const record = { guild_id: guildId, user_id: event.userId || null, event_type: event.type, created_at: new Date().toISOString() };
    const { error } = await this.supabase.from("analytics_events").insert(record);
    if (error) throw error;
  }

  async getStats(guildId) {
    const { data, error } = await this.supabase.from("analytics_events").select("event_type, user_id").eq("guild_id", guildId);
    if (error) throw error;
    const messages = data.filter((r) => r.event_type === "message").length;
    const members = new Set(data.filter((r) => r.event_type === "member").map((r) => r.user_id)).size;
    return { messages, members, total: data.length };
  }

  async getEvents(guildId, type = null, limit = 100) {
    let query = this.supabase.from("analytics_events").select("*").eq("guild_id", guildId).order("created_at", { ascending: false }).limit(limit);
    if (type) query = query.eq("event_type", type);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  // Alias du périmètre Admin Panel (statistiques par serveur).
  async getServerStats(guildId) {
    return this.getStats(guildId);
  }

  // Agrégats globaux pour le dashboard Admin (sans filtre guild).
  async getGlobalStats() {
    const { data, error } = await this.supabase.from("analytics_events").select("event_type, user_id, guild_id");
    if (error) throw error;
    const rows = data || [];
    const messages = rows.filter((r) => r.event_type === "message").length;
    const members = new Set(rows.filter((r) => r.event_type === "member").map((r) => r.user_id)).size;
    const servers = new Set(rows.map((r) => r.guild_id).filter(Boolean)).size;
    return { messages, members, servers };
  }
}

module.exports = { SupabaseAnalyticsRepository };
