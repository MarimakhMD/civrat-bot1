"use strict";

// Doublure en mémoire pour tests — simule advisory_lock et comptage atomique.
// Ne prouve pas PostgreSQL : l'isolation réelle (SERIALIZABLE, advisory_xact_lock, RLS) reste à valider PG.
class InMemoryTicketReservationRepository {
  constructor() {
    if (process.env.NODE_ENV === "production") {
      throw new Error("InMemoryTicketReservationRepository forbidden in production — Supabase required");
    }
    this.reservations = new Map(); // request_id -> {guild_id, user_id, category_id, state, channel_id, actor_id, created_at}
    this.locks = new Map(); // lockKey -> Promise queue
  }

  // Emulation pg_advisory_xact_lock : file d'attente robuste aux appels concurrents rapides
  async withLock(key, fn) {
    let entry = this.locks.get(key);
    if (!entry) {
      entry = { locked: true, waiting: [] };
      this.locks.set(key, entry);
    } else if (entry.locked) {
      await new Promise(resolve => entry.waiting.push(resolve));
      entry.locked = true;
    } else {
      entry.locked = true;
    }
    try {
      return await fn();
    } finally {
      if (entry.waiting.length > 0) {
        const nextResolve = entry.waiting.shift();
        nextResolve();
      } else {
        entry.locked = false;
        this.locks.delete(key);
      }
    }
  }

  async reserveOpen({ guildId, userId, categoryId, requestId, actorId, globalLimit, categoryLimit, countGlobal, countCategory }) {
    const memberLock = `civrat-ticket-reserve:${guildId}:${userId}`;
    const exec = async () => {
      if (this.reservations.has(requestId)) {
        const existing = this.reservations.get(requestId);
        if (existing.guild_id !== guildId || existing.user_id !== userId || (existing.category_id||null) !== (categoryId||null)) {
          throw Object.assign(new Error("idempotency conflict"), { code: "P0001" });
        }
        return existing;
      }
      if (countGlobal != null && globalLimit != null && countGlobal >= globalLimit) {
        const e = new Error("TICKET_LIMIT_REACHED"); e.code = "TICKET_LIMIT_REACHED"; e.hint = "TICKET_LIMIT_REACHED"; throw e;
      }
      if (categoryId && categoryLimit != null && countCategory != null && countCategory >= categoryLimit) {
        const e = new Error("TICKET_CATEGORY_LIMIT_REACHED"); e.code = "TICKET_CATEGORY_LIMIT_REACHED"; e.hint = "TICKET_CATEGORY_LIMIT_REACHED"; throw e;
      }
      const res = {
        request_id: requestId, guild_id: guildId, user_id: userId, category_id: categoryId || null,
        channel_id: null, actor_id: actorId, state: "reserved", revision: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString()
      };
      this.reservations.set(requestId, res);
      return res;
    };
    return await this.withLock(memberLock, exec);
  }

  // Variante atomique : le comptage est fait à l'intérieur du verrou via checkFn (évite la course)
  async reserveOpenAtomic({ guildId, userId, categoryId, requestId, actorId }, checkFn) {
    const memberLock = `civrat-ticket-reserve:${guildId}:${userId}`;
    return await this.withLock(memberLock, async () => {
if (this.reservations.has(requestId)) {
        const existing = this.reservations.get(requestId);
        if (existing.guild_id !== guildId || existing.user_id !== userId || (existing.category_id||null) !== (categoryId||null)) {
          throw Object.assign(new Error("idempotency conflict"), { code: "P0001" });
        }
        return existing;
      }
      await checkFn();
      const res = {
        request_id: requestId, guild_id: guildId, user_id: userId, category_id: categoryId || null,
        channel_id: null, actor_id: actorId, state: "reserved", revision: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString()
      };
      this.reservations.set(requestId, res);
      return res;
    });
  }

  async finalizeOpen({ requestId, channelId }) {
    const res = this.reservations.get(requestId);
    if (!res || !["reserved","external_pending","channel_known"].includes(res.state)) {
      throw Object.assign(new Error("reservation not finalizable"), { code: "P0001" });
    }
    res.channel_id = channelId;
    res.state = "finalized";
    res.revision++;
    res.updated_at = new Date().toISOString();
    return res;
  }

  async cancelReservation({ requestId }) {
    const res = this.reservations.get(requestId);
    if (!res || !["reserved","external_pending","channel_known","cleanup_pending"].includes(res.state)) {
      throw Object.assign(new Error("reservation not cancellable"), { code: "P0001" });
    }
    res.state = "cancelled";
    res.revision++;
    res.updated_at = new Date().toISOString();
    return res;
  }

  async listForUser(guildId, userId) {
    return [...this.reservations.values()].filter(r => r.guild_id === guildId && r.user_id === userId && ["reserved","external_pending","channel_known"].includes(r.state));
  }

  async listForCategory(guildId, userId, categoryId) {
    return [...this.reservations.values()].filter(r => r.guild_id === guildId && r.user_id === userId && r.category_id === categoryId && ["reserved","external_pending","channel_known"].includes(r.state));
  }

  async get(requestId) { return this.reservations.get(requestId) || null; }

  async listPending({ guildId = null, threshold = null, limit = 50 } = {}) {
    let list = [...this.reservations.values()].filter(r => ["reserved","external_pending","channel_known","cleanup_pending"].includes(r.state));
    if (guildId) list = list.filter(r => r.guild_id === guildId);
    if (threshold) list = list.filter(r => new Date(r.created_at) < new Date(threshold));
    return list.slice(0, limit);
  }

  async tryLock(requestId) {
    // InMemory mono-process : toujours disponible (le withLock sérialise déjà)
    return true;
  }

  async unlock(requestId) { return true; }

  // Pour réconciliation : lister incertains
  async listUnresolved(guildId) {
    return [...this.reservations.values()].filter(r => r.guild_id === guildId && ["reserved","external_pending","channel_known","cleanup_pending"].includes(r.state));
  }
}

module.exports = { InMemoryTicketReservationRepository };
