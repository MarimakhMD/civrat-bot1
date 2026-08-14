"use strict";

const { PremiumHistoryRepository } = require("./PremiumHistoryRepository");

class SupabasePremiumHistoryRepository extends PremiumHistoryRepository {
  constructor({ supabase }) {
    super();
    this.supabase = supabase;
  }

  async append(entry) {
    const { error } = await this.supabase.from("guild_entitlement_history").insert({
      guild_id: entry.guildId,
      feature_key: entry.feature,
      action: entry.action, // "activate" | "deactivate" | "revoke_abuse"
      actor_id: entry.actorId,
      old_status: entry.oldStatus ?? null,
      new_status: entry.newStatus ?? null,
      old_ends_at: entry.oldEndsAt ?? null,
      new_ends_at: entry.newEndsAt ?? null,
      plan: entry.plan ?? null,
      reason: entry.reason ?? null,
      created_at: new Date().toISOString(),
    });
    if (error) throw error;
  }

  async listByGuild(guildId, { limit = 20, offset = 0 } = {}) {
    const { data, error } = await this.supabase
      .from("guild_entitlement_history")
      .select("*")
      .eq("guild_id", guildId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw error;
    return data || [];
  }

  async listRecent({ limit = 20 } = {}) {
    const { data, error } = await this.supabase
      .from("guild_entitlement_history")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data || [];
  }
}

module.exports = { SupabasePremiumHistoryRepository };
