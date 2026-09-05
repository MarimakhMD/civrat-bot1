"use strict";

class TicketRepository {
  async findOpen(_guildId, _userId) { throw new Error("TicketRepository.findOpen must be implemented."); }
  // 4G C2 — la guilde fait partie de la clé de lecture : un salon ne résout un
  // ticket QUE dans sa propre guilde.
  async findByChannel(_guildId, _channelId) { throw new Error("TicketRepository.findByChannel must be implemented."); }
  async create(_record) { throw new Error("TicketRepository.create must be implemented."); }
  // 4G C2 — la guilde fait partie de la clé d'ÉCRITURE comme de la clé de
  // lecture : un salon ne peut être mis à jour QUE dans sa propre guilde.
  async updateByChannel(_guildId, _channelId, _updates) { throw new Error("TicketRepository.updateByChannel must be implemented."); }
}

module.exports = { TicketRepository };
