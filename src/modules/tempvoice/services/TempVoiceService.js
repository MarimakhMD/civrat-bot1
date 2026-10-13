"use strict";

const { RATE_LIMITS } = require("../../../core/rateLimit/ActionRateLimitGuard");

class TempVoiceService {
  constructor({ transport, config, tempChannels, repository = null, guildId = null, rateLimitGuard = null } = {}) {
    this.transport = transport;
    this.config = config;
    this.tempChannels = tempChannels instanceof Set ? tempChannels : new Set();
    // B5-b — dépôt durable (Supabase ou InMemory). Optionnel : sans lui, le
    // service conserve EXACTEMENT son comportement historique (Set mémoire).
    this.repository = repository;
    this.guildId = guildId;
    // P6 §3 — rate-limit de création de salon (4 / 60 s par guild+user).
    // Instance ABSENTE = pas de garde (tests unitaires historiques) ; la
    // production passe `sharedRateLimitGuard` via le runtime.
    this.rateLimitGuard = rateLimitGuard;
  }

  isLobby(channelId) {
    return channelId && channelId === this.config.tempvoice_lobby_channel_id;
  }

  isTempChannel(channelId) {
    return this.tempChannels.has(channelId);
  }

  async handleJoin({ member, channelId }) {
    if (!this.config.tempvoice_enabled) return { handled: false, code: "TEMPVOICE_DISABLED" };
    if (!this.isLobby(channelId)) return { handled: false, code: "NOT_LOBBY" };
    // P6 §3 — rate-limit UNIQUEMENT quand une room doit être créée : le credit
    // est consommé ici, AVANT `createChannel` et toute écriture DB. Rejoindre
    // une room existante ne passe jamais par handleJoin (runtime : lobby
    // seulement) et ne consomme donc rien. Au dépassement : ni salon créé, ni
    // INSERT — le membre reste dans le lobby, cohérent avec l'échec historique.
    const guildId = this.guildId || (member && member.guild && member.guild.id) || null;
    if (this.rateLimitGuard && guildId && member && member.id) {
      const { group, limit, windowMs } = RATE_LIMITS.TEMPVOICE;
      const gate = this.rateLimitGuard.check({ guildId, userId: member.id, group, limit, windowMs });
      if (!gate.allowed) return { handled: false, code: "TEMPVOICE_RATE_LIMITED" };
      this.rateLimitGuard.record({ guildId, userId: member.id, group, limit, windowMs });
    }
    const name = `${member.user.username}'s room`;
    const parentId = this.config.tempvoice_category_id || null;
    let channel;
    try {
      channel = await this.transport.createChannel({ name, parentId, userId: member.id });
      this.tempChannels.add(channel.id);
      await this.transport.moveMember(member, channel.id);
    } catch {
      return { handled: false, code: "TEMPVOICE_CREATE_FAILED" };
    }
    // B5-b — persistance DURABLE, best-effort et hors du try/catch de création :
    // une panne Supabase ne doit jamais faire échouer un salon déjà fonctionnel.
    // `channelId` reçu EST le lobby (handleJoin n'est appelé que depuis le lobby).
    if (this.repository && this.guildId) {
      try {
        await this.repository.create({
          guildId: this.guildId,
          channelId: channel.id,
          ownerId: member.id,
          lobbyId: channelId,
        });
      } catch {
        // best-effort : l'absence de persistance ne casse pas la session courante.
      }
    }
    return { handled: true, code: "TEMPVOICE_CREATED", channelId: channel.id };
  }

  async handleLeave({ channelId }) {
    if (!this.isTempChannel(channelId)) return { handled: false, code: "NOT_TEMP" };
    try {
      const empty = await this.transport.isEmpty(channelId);
      if (!empty) return { handled: false, code: "TEMPVOICE_NOT_EMPTY" };
      await this.transport.deleteChannel(channelId);
      this.tempChannels.delete(channelId);
    } catch {
      return { handled: false, code: "TEMPVOICE_DELETE_FAILED" };
    }
    // B5-b — suppression du suivi durable, best-effort : une ligne obsolète
    // résiduelle sera réconciliée par B5-c, jamais bloquante ici.
    if (this.repository && this.guildId) {
      try {
        await this.repository.delete(this.guildId, channelId);
      } catch {
        // best-effort
      }
    }
    return { handled: true, code: "TEMPVOICE_DELETED", channelId };
  }
}

module.exports = { TempVoiceService };
