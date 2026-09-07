"use strict";

class TempVoiceRepository {
  async create(_record) {
    throw new Error("TempVoiceRepository.create must be implemented");
  }

  async findByChannel(_guildId, _channelId) {
    throw new Error("TempVoiceRepository.findByChannel must be implemented");
  }

  async findByGuild(_guildId) {
    throw new Error("TempVoiceRepository.findByGuild must be implemented");
  }

  async delete(_guildId, _channelId) {
    throw new Error("TempVoiceRepository.delete must be implemented");
  }
}

/**
 * Repli mémoire — B5-b.
 *
 * Comme InMemoryXPRepository (B3), ce dépôt reproduit la SÉMANTIQUE du dépôt
 * durable (cloisonnement par guild_id, enregistrement complet) pour que les
 * tests valident un chemin que la production peut réellement emprunter quand
 * Supabase n'est pas disponible.
 *
 * L'atomicité est triviale : JavaScript est mono-thread et aucune méthode ne
 * contient d'await entre la lecture et l'écriture.
 */
class InMemoryTempVoiceRepository extends TempVoiceRepository {
  constructor() {
    super();
    this.store = new Map(); // key: "guildId:channelId" -> record
  }

  _key(guildId, channelId) {
    return `${guildId}:${channelId}`;
  }

  async create(record) {
    const stored = {
      guildId: record.guildId,
      channelId: record.channelId,
      ownerId: record.ownerId,
      lobbyId: record.lobbyId,
      createdAt: record.createdAt || null,
    };
    this.store.set(this._key(record.guildId, record.channelId), stored);
    return { ...stored };
  }

  async findByChannel(guildId, channelId) {
    const record = this.store.get(this._key(guildId, channelId));
    return record ? { ...record } : null;
  }

  async findByGuild(guildId) {
    const rows = [];
    for (const record of this.store.values()) {
      if (record.guildId === guildId) rows.push({ ...record });
    }
    return rows;
  }

  async delete(guildId, channelId) {
    this.store.delete(this._key(guildId, channelId));
  }

  clear() {
    this.store.clear();
  }
}

module.exports = { TempVoiceRepository, InMemoryTempVoiceRepository };
