"use strict";

const { AdminAuditRepository } = require("./AdminAuditRepository");
const { toPersistenceError } = require("../../../adapters/supabase/supabaseErrorClassifier");

// ───────────────────────────────────────────────────────────────
// 4D/R8 — plafonds de la pagination d'audit.
//
// `limit` et `offset` alimentent directement un `.range()` : sans clamp, un
// appelant (ou un customId forgé qui remonterait jusqu'ici) pourrait demander
// des dizaines de milliers de lignes. Le plafond est fixé bien sous le
// `db-max-rows` de PostgREST (1000 par défaut sur Supabase) pour qu'une page
// ne soit JAMAIS tronquée silencieusement par le serveur.
// ───────────────────────────────────────────────────────────────
const AUDIT_DEFAULT_LIMIT = 20;
const AUDIT_MAX_LIMIT = 200;
const AUDIT_MAX_OFFSET = 100000;

function boundedLimit(value, fallback = AUDIT_DEFAULT_LIMIT) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.trunc(n), AUDIT_MAX_LIMIT);
}

function boundedOffset(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.trunc(n), AUDIT_MAX_OFFSET);
}

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
    // 4F-2b — erreur PostgREST classifiée (permission / réseau / schéma) au lieu
    // d'une erreur brute indistingable.
    if (error) throw toPersistenceError(error, { operation: "append", resource: "civrat_admin_audit" });
  }

  async list({ limit = 20, offset = 0, guildId = null } = {}) {
    // 4D/R8 — bornes appliquées DANS le dépôt : un appelant qui oublierait de
    // clamer ne peut plus provoquer de lecture déraisonnable.
    const safeLimit = boundedLimit(limit);
    const safeOffset = boundedOffset(offset);
    let query = this.supabase.from("civrat_admin_audit").select("*").order("created_at", { ascending: false }).range(safeOffset, safeOffset + safeLimit - 1);
    if (guildId) query = query.eq("guild_id", guildId);
    const { data, error } = await query;
    if (error) throw toPersistenceError(error, { operation: "list", resource: "civrat_admin_audit" });
    return data || [];
  }

  async count({ guildId = null } = {}) {
    let query = this.supabase.from("civrat_admin_audit").select("id", { count: "exact", head: true });
    if (guildId) query = query.eq("guild_id", guildId);
    const { count, error } = await query;
    if (error) throw toPersistenceError(error, { operation: "count", resource: "civrat_admin_audit" });
    return count ?? 0;
  }
}

module.exports = { SupabaseAdminAuditRepository };
