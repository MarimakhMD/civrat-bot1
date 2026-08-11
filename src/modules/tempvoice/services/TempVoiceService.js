"use strict";

class TempVoiceService {
  constructor({ transport, config, tempChannels } = {}) {
    this.transport = transport;
    this.config = config;
    this.tempChannels = tempChannels instanceof Set ? tempChannels : new Set();
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
    const name = `${member.user.username}'s room`;
    const parentId = this.config.tempvoice_category_id || null;
    try {
      const channel = await this.transport.createChannel({ name, parentId, userId: member.id });
      this.tempChannels.add(channel.id);
      await this.transport.moveMember(member, channel.id);
      return { handled: true, code: "TEMPVOICE_CREATED", channelId: channel.id };
    } catch {
      return { handled: false, code: "TEMPVOICE_CREATE_FAILED" };
    }
  }

  async handleLeave({ channelId }) {
    if (!this.isTempChannel(channelId)) return { handled: false, code: "NOT_TEMP" };
    try {
      const empty = await this.transport.isEmpty(channelId);
      if (!empty) return { handled: false, code: "TEMPVOICE_NOT_EMPTY" };
      await this.transport.deleteChannel(channelId);
      this.tempChannels.delete(channelId);
      return { handled: true, code: "TEMPVOICE_DELETED", channelId };
    } catch {
      return { handled: false, code: "TEMPVOICE_DELETE_FAILED" };
    }
  }
}

module.exports = { TempVoiceService };
