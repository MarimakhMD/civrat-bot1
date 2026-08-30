"use strict";

const {
  EntitlementRepository,
  PremiumMutationOperation,
  PremiumMutationPolicy,
} = require("../../core/entitlements");

class SupabaseEntitlementRepository extends EntitlementRepository {
  constructor({ supabase, mutationPolicy = null }) {
    super();
    this.supabase = supabase;
    // A private default remains fail-closed for direct protected-guild writes.
    // Production injects the exact policy instance shared by EntitlementService.
    Object.defineProperty(this, "mutationPolicy", {
      value: mutationPolicy || new PremiumMutationPolicy(),
      enumerable: false,
      configurable: false,
      writable: false,
    });
  }

  async findFeature(guildId, feature) {
    const { data, error } = await this.supabase
      .from("guild_entitlements")
      .select("*")
      .eq("guild_id", guildId)
      .eq("feature_key", feature)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async listFeatures(guildId) {
    const { data, error } = await this.supabase
      .from("guild_entitlements")
      .select("*")
      .eq("guild_id", guildId)
      .order("feature_key", { ascending: true });
    if (error) throw error;
    return data || [];
  }

  async listAll() {
    const { data, error } = await this.supabase
      .from("guild_entitlements")
      .select("*")
      .order("guild_id", { ascending: true });
    if (error) throw error;
    return data || [];
  }

  async activate(record, permit = null) {
    this.mutationPolicy.assertRepositoryMutation({
      guildId: record?.guild_id,
      feature: record?.feature_key,
      operation: PremiumMutationOperation.ACTIVATE,
      permit,
    });

    const { error } = await this.supabase
      .from("guild_entitlements")
      .upsert(record, { onConflict: "guild_id,feature_key" });
    if (error) throw error;
  }

  async setStatus(guildId, feature, status, permit = null) {
    this.mutationPolicy.assertRepositoryMutation({
      guildId,
      feature,
      operation: PremiumMutationOperation.SET_STATUS,
      permit,
    });

    const { error } = await this.supabase
      .from("guild_entitlements")
      .update({ status })
      .eq("guild_id", guildId)
      .eq("feature_key", feature);
    if (error) throw error;
  }
}

module.exports = { SupabaseEntitlementRepository };
