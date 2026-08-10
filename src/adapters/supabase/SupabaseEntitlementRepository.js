"use strict";
const { EntitlementRepository } = require("../../core/entitlements");
class SupabaseEntitlementRepository extends EntitlementRepository { constructor({ supabase }) { super(); this.supabase = supabase; } async findFeature(guildId, feature) { const { data, error } = await this.supabase.from("guild_entitlements").select("*").eq("guild_id", guildId).eq("feature_key", feature).maybeSingle(); if (error) throw error; return data; } }
module.exports = { SupabaseEntitlementRepository };
