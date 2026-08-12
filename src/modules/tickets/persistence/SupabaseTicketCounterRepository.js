"use strict";

const { TicketCounterRepository } = require("./TicketCounterRepository");

// Compteur atomique via la fonction RPC Supabase increment_ticket_counter
// (INSERT … ON CONFLICT DO UPDATE … RETURNING = verrou de ligne, atomique en
// créations simultanées). La fonction doit exister côté base, cf.
// docs/architecture/phase-10-4-ticket-counter.md — toute erreur est levée et
// le moteur retombe alors sur le nommage Free (fail-closed).
class SupabaseTicketCounterRepository extends TicketCounterRepository {
  constructor({ supabase }) {
    super();
    this.supabase = supabase;
  }

  async next(guildId) {
    if (!this.supabase) throw new Error("counter_storage_unavailable");
    const { data, error } = await this.supabase.rpc("increment_ticket_counter", { p_guild_id: guildId });
    if (error) throw error;
    const value = Number(data);
    if (!Number.isInteger(value) || value < 1) throw new Error("counter_invalid_value");
    return value;
  }
}

module.exports = { SupabaseTicketCounterRepository };
