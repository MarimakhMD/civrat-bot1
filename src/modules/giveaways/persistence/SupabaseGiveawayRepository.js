"use strict";

class SupabaseGiveawayRepository {
  constructor({ supabase }) {
    if (!supabase || typeof supabase.from !== "function") {
      throw new TypeError("SupabaseGiveawayRepository requires a supabase client");
    }
    this.supabase = supabase;
  }

  async create({ guildId, channelId, prize, winnersCount, endsAt, messageId }) {
    const record = { guild_id: guildId, channel_id: channelId, prize, winners_count: winnersCount, ends_at: endsAt, message_id: messageId, status: "open" };
    const { data, error } = await this.supabase.from("giveaways").insert(record).select().single();
    if (error) throw error;
    return data;
  }

  async findById(id) {
    const { data, error } = await this.supabase.from("giveaways").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data;
  }

  async findByMessageId(messageId) {
    const { data, error } = await this.supabase.from("giveaways").select("*").eq("message_id", messageId).maybeSingle();
    if (error) throw error;
    return data;
  }

  async join(giveawayId, userId) {
    const { data, error } = await this.supabase.from("giveaway_entries").insert({ giveaway_id: giveawayId, user_id: userId }).select().single();
    if (error) {
      if (error.code === "23505") return { alreadyJoined: true };
      throw error;
    }
    return { alreadyJoined: false, entry: data };
  }

  async listEntries(giveawayId) {
    const { data, error } = await this.supabase.from("giveaway_entries").select("user_id").eq("giveaway_id", giveawayId);
    if (error) throw error;
    return data || [];
  }

  async draw(giveawayId) {
    const entries = await this.listEntries(giveawayId);
    if (!entries.length) return { winners: [], entries };
    // Simple random pick, will be mocked in tests
    const shuffled = [...entries].sort(() => Math.random() - 0.5);
    const giveaway = await this.findById(giveawayId);
    const count = giveaway ? giveaway.winners_count : 1;
    return { winners: shuffled.slice(0, count).map((e) => e.user_id), entries };
  }

  async close(giveawayId) {
    const { data, error } = await this.supabase.from("giveaways").update({ status: "closed" }).eq("id", giveawayId).select().single();
    if (error) throw error;
    return data;
  }
}

module.exports = { SupabaseGiveawayRepository };
