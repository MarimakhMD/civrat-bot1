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
    return { messages, members, total: list.length };
  }

  async getEvents(guildId, type = null, limit = 100) {
    const list = this.events.get(guildId) || [];
    const filtered = type ? list.filter((e) => e.type === type) : list;
    return filtered.slice(-limit);
  }

  clear(guildId) {
    if (guildId) this.events.delete(guildId);
    else this.events.clear();
  }
}

module.exports = { InMemoryAnalyticsRepository };
