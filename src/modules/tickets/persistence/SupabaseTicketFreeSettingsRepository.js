"use strict";

const DEFAULT_OPEN_LIMIT = 1;

class SupabaseTicketFreeSettingsRepository {
  constructor({ supabase }) {
    if (!supabase || typeof supabase.from !== "function" || typeof supabase.rpc !== "function") throw new TypeError("privileged Supabase client required");
    this.supabase = supabase;
  }
  async get(guildId) {
    if (!guildId) throw new TypeError("guildId required");
    const { data, error } = await this.supabase.from("civrat_ticket_free_settings").select("guild_id, open_limit, transcript_mode").eq("guild_id", guildId).maybeSingle();
    if (error) throw error;
    if (!data) return { guildId, openLimit: DEFAULT_OPEN_LIMIT, transcriptMode: "required" };
    return { guildId: data.guild_id, openLimit: data.open_limit ?? DEFAULT_OPEN_LIMIT, transcriptMode: data.transcript_mode ?? "required" };
  }
  async setOpenLimit(guildId, openLimit) {
    if (!guildId || !Number.isInteger(openLimit) || openLimit < 1 || openLimit > 5) throw new TypeError("invalid_ticket_limit");
    const { data, error } = await this.supabase.from("civrat_ticket_free_settings").upsert({ guild_id: guildId, open_limit: openLimit, updated_at: new Date().toISOString() }, { onConflict: "guild_id" }).select("guild_id, open_limit").single();
    if (error) throw error;
    return { guildId: data.guild_id, openLimit: data.open_limit };
  }
}

module.exports = { SupabaseTicketFreeSettingsRepository, DEFAULT_OPEN_LIMIT };
