"use strict";

class InMemoryTicketFreeSettingsRepository {
  constructor() {
    if (process.env.NODE_ENV === "production") {
      throw new Error("InMemoryTicketFreeSettingsRepository forbidden in production");
    }
    this.settings = new Map();
  }
  async get(guildId) {
    const s = this.settings.get(guildId);
    if (!s) return { guildId, openLimit: 1, transcriptMode: "required" };
    return { guildId, openLimit: s.openLimit ?? 1, transcriptMode: s.transcriptMode ?? "required" };
  }
  async setOpenLimit(guildId, openLimit) {
    if (!Number.isInteger(openLimit) || openLimit < 1 || openLimit > 5) throw new TypeError("invalid_ticket_limit");
    const cur = this.settings.get(guildId) || {};
    cur.openLimit = openLimit;
    cur.guildId = guildId;
    this.settings.set(guildId, cur);
    return { guildId, openLimit };
  }
}

module.exports = { InMemoryTicketFreeSettingsRepository };
