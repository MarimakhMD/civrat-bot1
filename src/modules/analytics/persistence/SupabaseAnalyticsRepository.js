"use strict";

// P10 — plafonnement honnête des lectures Analytics.
//
// Avant ce correctif, getStats et getGlobalStats lisaient toutes les lignes
// sans .limit(). PostgREST applique alors db-max-rows (1000 par défaut) et
// renvoie 1000 lignes SANS erreur : les totaux affichés par /analytics et par
// le dashboard Admin étaient donc silencieusement faux (§19 — vrais analytics).
//
// Solution retenue, sans aucune migration :
//  • compteurs de lignes  -> HEAD + Prefer: count=exact. Le total exact arrive
//    dans Content-Range, AUCUNE ligne n'est transférée.
//  • compteurs distincts  -> PostgREST n'expose pas COUNT(DISTINCT …), donc
//    pagination par lots de ANALYTICS_COUNT_PAGE_SIZE avec un plafond de
//    sécurité. Le résultat est exact ; si le plafond est atteint on renvoie un
//    PLANCHER et truncated = true — jamais un faux exact.

const ANALYTICS_COUNT_PAGE_SIZE = 1000;
const ANALYTICS_DISTINCT_SCAN_CAP = 50000;

class SupabaseAnalyticsRepository {
  constructor({ supabase }) {
    if (!supabase || typeof supabase.from !== "function") {
      throw new TypeError("SupabaseAnalyticsRepository requires a supabase client");
    }
    this.supabase = supabase;
  }

  async track(guildId, event) {
    const record = { guild_id: guildId, user_id: event.userId || null, event_type: event.type, created_at: new Date().toISOString() };
    const { error } = await this.supabase.from("analytics_events").insert(record);
    if (error) throw error;
  }

  // Compte EXACT d'un nombre de lignes : requête HEAD + Prefer: count=exact.
  // Aucune ligne transférée ; le total vient de l'en-tête Content-Range.
  // Insensible à db-max-rows puisque aucune ligne n'est demandée.
  async #countRows({ guildId = null, eventType = null } = {}) {
    let query = this.supabase.from("analytics_events").select("*", { count: "exact", head: true });
    if (guildId) query = query.eq("guild_id", guildId);
    if (eventType) query = query.eq("event_type", eventType);
    const { count, error } = await query;
    if (error) throw error;
    const value = Number(count);
    return Number.isFinite(value) && value >= 0 ? value : 0;
  }

  // Compte DISTINCT exact par pagination bornée. `column` est un nom de
  // colonne interne figé (jamais une entrée utilisateur) : "user_id" | "guild_id".
  // Les valeurs nulles/vides sont ignorées, comme dans l'implémentation
  // InMemory historique (`if (e.type === "member" && e.userId)`).
  async #countDistinct(column, { guildId = null, eventType = null } = {}) {
    const seen = new Set();
    let scanned = 0;
    let truncated = false;
    for (let from = 0; ; from += ANALYTICS_COUNT_PAGE_SIZE) {
      if (scanned >= ANALYTICS_DISTINCT_SCAN_CAP) {
        truncated = true;
        break;
      }
      let query = this.supabase.from("analytics_events").select(column);
      if (guildId) query = query.eq("guild_id", guildId);
      if (eventType) query = query.eq("event_type", eventType);
      const { data, error } = await query.range(from, from + ANALYTICS_COUNT_PAGE_SIZE - 1);
      if (error) throw error;
      const rows = data || [];
      if (rows.length === 0) break;
      for (const row of rows) {
        const value = row[column];
        if (value) seen.add(value);
      }
      scanned += rows.length;
      if (rows.length < ANALYTICS_COUNT_PAGE_SIZE) break;
    }
    return { count: seen.size, truncated };
  }

  async getStats(guildId) {
    const [messages, total, distinctMembers] = await Promise.all([
      this.#countRows({ guildId, eventType: "message" }),
      this.#countRows({ guildId }),
      this.#countDistinct("user_id", { guildId, eventType: "member" }),
    ]);
    return { messages, members: distinctMembers.count, total, membersTruncated: distinctMembers.truncated };
  }

  async getEvents(guildId, type = null, limit = 100) {
    let query = this.supabase.from("analytics_events").select("*").eq("guild_id", guildId).order("created_at", { ascending: false }).limit(limit);
    if (type) query = query.eq("event_type", type);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  // Alias du périmètre Admin Panel (statistiques par serveur).
  async getServerStats(guildId) {
    return this.getStats(guildId);
  }

  // Agrégats globaux pour le dashboard Admin (sans filtre guild).
  async getGlobalStats() {
    const [messages, distinctMembers, distinctGuilds] = await Promise.all([
      this.#countRows({ eventType: "message" }),
      this.#countDistinct("user_id", { eventType: "member" }),
      this.#countDistinct("guild_id"),
    ]);
    return {
      messages,
      members: distinctMembers.count,
      servers: distinctGuilds.count,
      truncated: distinctMembers.truncated || distinctGuilds.truncated,
    };
  }
}

module.exports = { SupabaseAnalyticsRepository, ANALYTICS_COUNT_PAGE_SIZE, ANALYTICS_DISTINCT_SCAN_CAP };
