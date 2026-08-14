"use strict";

const { EntitlementRepository } = require("../../core/entitlements");

// Lecture ET écriture des entitlements via Supabase (table guild_entitlements).
// Aucune garde de constructeur (comme l'existant) : l'offline compose sans
// client et les méthodes lèvent seulement si on les appelle sans client — le
// service Admin Panel intercepte (fail-closed).
class SupabaseEntitlementRepository extends EntitlementRepository {
  constructor({ supabase }) {
    super();
    this.supabase = supabase;
  }

  async findFeature(guildId, feature) {
    const { data, error } = await this.supabase.from("guild_entitlements").select("*").eq("guild_id", guildId).eq("feature_key", feature).maybeSingle();
    if (error) throw error;
    return data;
  }

  async listFeatures(guildId) {
    const { data, error } = await this.supabase.from("guild_entitlements").select("*").eq("guild_id", guildId).order("feature_key", { ascending: true });
    if (error) throw error;
    return data || [];
  }

  async listAll() {
    const { data, error } = await this.supabase.from("guild_entitlements").select("*").order("guild_id", { ascending: true });
    if (error) throw error;
    return data || [];
  }

  async activate(record) {
    // onConflict (guild_id, feature_key) — contrainte UNIQUE documentée.
    const { error } = await this.supabase.from("guild_entitlements").upsert(record, { onConflict: "guild_id,feature_key" });
    if (error) throw error;
  }

  async setStatus(guildId, feature, status) {
    const { error } = await this.supabase.from("guild_entitlements").update({ status }).eq("guild_id", guildId).eq("feature_key", feature);
    if (error) throw error;
  }
}

module.exports = { SupabaseEntitlementRepository };
