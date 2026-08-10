"use strict";

const { TicketRepository } = require("./TicketRepository");

class SupabaseTicketRepository extends TicketRepository {
  constructor({ supabase }) { super(); this.supabase = supabase; }

  async findOpen(guildId, userId) {
    const { data, error } = await this.supabase.from("tickets").select("*").eq("guild_id", guildId).eq("user_id", userId).in("status", ["open", "claimed"]).maybeSingle();
    if (error) throw error;
    return data;
  }

  async findByChannel(channelId) {
    const { data, error } = await this.supabase.from("tickets").select("*").eq("channel_id", channelId).maybeSingle();
    if (error) throw error;
    return data;
  }

  async create(record) {
    const { data, error } = await this.supabase.from("tickets").insert(record).select().single();
    if (error) throw error;
    return data;
  }

  async updateByChannel(channelId, updates) {
    const { data, error } = await this.supabase.from("tickets").update(updates).eq("channel_id", channelId).select().single();
    if (error) throw error;
    return data;
  }

  async updateTicketRecord(channelId, updates) { return this.updateByChannel(channelId, updates); }
}

module.exports = { SupabaseTicketRepository };
