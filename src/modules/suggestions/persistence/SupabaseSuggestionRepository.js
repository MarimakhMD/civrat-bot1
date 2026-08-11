"use strict";

class SupabaseSuggestionRepository {
  constructor({ supabase }) {
    if (!supabase || typeof supabase.from !== "function") {
      throw new TypeError("SupabaseSuggestionRepository requires a supabase client");
    }
    this.supabase = supabase;
  }

  async create({ guildId, channelId, messageId, authorId, content }) {
    const record = { guild_id: guildId, channel_id: channelId, message_id: messageId, author_id: authorId, content, status: "pending", up_votes: 0, down_votes: 0 };
    const { data, error } = await this.supabase.from("suggestions").insert(record).select().single();
    if (error) throw error;
    return data;
  }

  async findById(id) {
    const { data, error } = await this.supabase.from("suggestions").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data;
  }

  async findByMessageId(messageId) {
    const { data, error } = await this.supabase.from("suggestions").select("*").eq("message_id", messageId).maybeSingle();
    if (error) throw error;
    return data;
  }

  async vote(id, userId, value) {
    // Check existing vote
    const { data: existing, error: findError } = await this.supabase.from("suggestion_votes").select("*").eq("suggestion_id", id).eq("user_id", userId).maybeSingle();
    if (findError) throw findError;
    if (existing) {
      if (existing.value === value) return { alreadyVoted: true, vote: existing };
      // Update vote
      const { data, error } = await this.supabase.from("suggestion_votes").update({ value }).eq("suggestion_id", id).eq("user_id", userId).select().single();
      if (error) throw error;
      // Update counts
      const { data: suggestion } = await this.supabase.from("suggestions").select("up_votes, down_votes").eq("id", id).single();
      let up = suggestion.up_votes, down = suggestion.down_votes;
      if (value === 1 && existing.value === -1) { up++; down--; } else if (value === -1 && existing.value === 1) { up--; down++; }
      await this.supabase.from("suggestions").update({ up_votes: up, down_votes: down }).eq("id", id);
      return { alreadyVoted: false, vote: data };
    }
    const { data, error } = await this.supabase.from("suggestion_votes").insert({ suggestion_id: id, user_id: userId, value }).select().single();
    if (error) throw error;
    const { data: suggestion } = await this.supabase.from("suggestions").select("up_votes, down_votes").eq("id", id).single();
    const up = suggestion.up_votes + (value === 1 ? 1 : 0);
    const down = suggestion.down_votes + (value === -1 ? 1 : 0);
    await this.supabase.from("suggestions").update({ up_votes: up, down_votes: down }).eq("id", id);
    return { alreadyVoted: false, vote: data };
  }

  async updateStatus(id, status) {
    const { data, error } = await this.supabase.from("suggestions").update({ status }).eq("id", id).select().single();
    if (error) throw error;
    return data;
  }

  async delete(id) {
    const { error } = await this.supabase.from("suggestions").delete().eq("id", id);
    if (error) throw error;
    await this.supabase.from("suggestion_votes").delete().eq("suggestion_id", id);
    return { deleted: true };
  }
}

module.exports = { SupabaseSuggestionRepository };
