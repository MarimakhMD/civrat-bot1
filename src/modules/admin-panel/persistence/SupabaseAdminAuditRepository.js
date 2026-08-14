"use strict";

const { AdminAuditRepository } = require("./AdminAuditRepository");

class SupabaseAdminAuditRepository extends AdminAuditRepository {
  constructor({ supabase }) {
    super();
    this.supabase = supabase;
  }

  async append(entry) {
    const { error } = await this.supabase.from("civrat_admin_audit").insert({
      actor_id: entry.actorId,
      guild_id: entry.guildId ?? null,
      action: entry.action,
      old_value: entry.oldValue ?? null,
      new_value: entry.newValue ?? null,
      reason: entry.reason ?? null,
      created_at: new Date().toISOString(),
    });
    if (error) throw error;
  }

  async list({ limit = 20, offset = 0, guildId = null } = {}) {
    let query = this.supabase.from("civrat_admin_audit").select("*").order("created_at", { ascending: false }).range(offset, offset + limit - 1);
    if (guildId) query = query.eq("guild_id", guildId);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  async count({ guildId = null } = {}) {
    let query = this.supabase.from("civrat_admin_audit").select("id", { count: "exact", head: true });
    if (guildId) query = query.eq("guild_id", guildId);
    const { count, error } = await query;
    if (error) throw error;
    return count ?? 0;
  }
}

module.exports = { SupabaseAdminAuditRepository };
