"use strict";

const { TicketCounterRepository } = require("./TicketCounterRepository");

// Compteur en mémoire, strictement atomique JavaScript (incrément synchrone) :
// utilisé par les tests (créations simultanées, indépendance par guilde,
// continuité au « redémarrage » = nouvelle instance de service sur le même
// repository). Ne pas utiliser en production : la référence est la RPC
// Supabase (persistance garantie).
class InMemoryTicketCounterRepository extends TicketCounterRepository {
  constructor() {
    super();
    this.counters = new Map();
  }

  async next(guildId) {
    const value = (this.counters.get(guildId) || 0) + 1;
    this.counters.set(guildId, value);
    return value;
  }
}

module.exports = { InMemoryTicketCounterRepository };
