"use strict";

const { PremiumHistoryRepository } = require("./PremiumHistoryRepository");

// 4D/R9 — mêmes plafonds que l'audit Admin : `limit`/`offset` alimentent un
// `.range()` ou un `.limit()`, et le plafond reste sous le `db-max-rows` de
// PostgREST pour qu'aucune page ne soit tronquée silencieusement.
const HISTORY_DEFAULT_LIMIT = 20;
const HISTORY_MAX_LIMIT = 200;
const HISTORY_MAX_OFFSET = 100000;

function boundedLimit(value, fallback = HISTORY_DEFAULT_LIMIT) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.trunc(n), HISTORY_MAX_LIMIT);
}

function boundedOffset(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.trunc(n), HISTORY_MAX_OFFSET);
}

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
    // 4D/R9 — bornes appliquées DANS le dépôt.
    const safeLimit = boundedLimit(limit);
    const safeOffset = boundedOffset(offset);
    const { data, error } = await this.supabase
      .from("guild_entitlement_history")
      .select("*")
      .eq("guild_id", guildId)
      .order("created_at", { ascending: false })
      .range(safeOffset, safeOffset + safeLimit - 1);
    if (error) throw error;
    return data || [];
  }

  async listRecent({ limit = 20 } = {}) {
    // 4D/R9 — `limit` clampé : sans plafond, un `.limit(1e9)` serait ramené à
    // `db-max-rows` par le serveur, silencieusement.
    const { data, error } = await this.supabase
      .from("guild_entitlement_history")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(boundedLimit(limit));
    if (error) throw error;
    return data || [];
  }
}

module.exports = { SupabasePremiumHistoryRepository };
