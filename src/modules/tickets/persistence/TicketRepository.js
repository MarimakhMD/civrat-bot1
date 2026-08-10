"use strict";

class TicketRepository {
  async findOpen(_guildId, _userId) { throw new Error("TicketRepository.findOpen must be implemented."); }
  async findByChannel(_channelId) { throw new Error("TicketRepository.findByChannel must be implemented."); }
  async create(_record) { throw new Error("TicketRepository.create must be implemented."); }
  async updateByChannel(_channelId, _updates) { throw new Error("TicketRepository.updateByChannel must be implemented."); }
}

module.exports = { TicketRepository };
