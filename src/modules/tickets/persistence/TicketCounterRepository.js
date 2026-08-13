"use strict";

// Contrat du compteur de tickets (Phase 10.4). next(guildId) DOIT être
// atomique en concurrence et retourner des entiers 1, 2, 3… indépendants par
// guilde et persistants au redémarrage (implémentation de référence : RPC
// Supabase, cf. docs/architecture/phase-10-4-ticket-counter.md).
class TicketCounterRepository {
  async next(_guildId) {
    throw new Error("TicketCounterRepository.next must be implemented.");
  }
}

module.exports = { TicketCounterRepository };
