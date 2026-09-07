"use strict";

class InMemoryAnalyticsRepository {
  constructor() {
    this.events = new Map(); // guildId -> Array<{type, userId, timestamp}>
  }

  async track(guildId, event) {
    if (!guildId || !event || !event.type) return;
    const list = this.events.get(guildId) || [];
    list.push({ ...event, guildId, timestamp: Date.now() });
    this.events.set(guildId, list);
  }

  async getStats(guildId) {
    const list = this.events.get(guildId) || [];
    const messages = list.filter((e) => e.type === "message").length;
    const members = new Set(list.filter((e) => e.type === "member").map((e) => e.userId)).size;
    // P10 — parité de contrat avec SupabaseAnalyticsRepository : le dépôt en
    // mémoire ne pagine jamais, donc le drapeau de troncature est toujours
    // faux. Les valeurs calculées sont strictement inchangées.
    return { messages, members, total: list.length, membersTruncated: false };
  }

  async getEvents(guildId, type = null, limit = 100) {
    const list = this.events.get(guildId) || [];
    const filtered = type ? list.filter((e) => e.type === type) : list;
    return filtered.slice(-limit);
  }

  // Alias du périmètre Admin Panel (statistiques par serveur).
  async getServerStats(guildId) {
    return this.getStats(guildId);
  }

  // Agrégats globaux (dashboard Admin).
  async getGlobalStats() {
    let messages = 0;
    const memberIds = new Set();
    const guildIds = new Set();
    for (const [guildId, list] of this.events.entries()) {
      guildIds.add(guildId);
      for (const e of list) {
        if (e.type === "message") messages += 1;
        if (e.type === "member" && e.userId) memberIds.add(e.userId);
      }
    }
    return { messages, members: memberIds.size, servers: guildIds.size, truncated: false };
  }

  clear(guildId) {
    if (guildId) this.events.delete(guildId);
    else this.events.clear();
  }
}

module.exports = { InMemoryAnalyticsRepository };
