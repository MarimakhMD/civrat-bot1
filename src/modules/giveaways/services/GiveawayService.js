"use strict";

class GiveawayService {
  constructor({ configService, repository, transport, logsRuntime }) {
    if (!configService || typeof configService.read !== "function") {
      throw new TypeError("GiveawayService requires a configService");
    }
    if (!repository) throw new TypeError("GiveawayService requires a repository");
    this.configService = configService;
    this.repository = repository;
    this.transport = transport;
    this.logsRuntime = logsRuntime;
  }

  async create({ guildId, channelId, prize, winnersCount, durationMinutes }) {
    const config = await this.configService.read(guildId);
    if (!config.giveaway_enabled) return { ok: false, code: "GIVEAWAY_DISABLED" };
    if (!prize || prize.trim().length < 2) return { ok: false, code: "GIVEAWAY_INVALID_PRIZE" };
    const endsAt = new Date(Date.now() + (durationMinutes || 1440) * 60 * 1000).toISOString();
    let giveaway;
    try {
      giveaway = await this.repository.create({ guildId, channelId: channelId || config.giveaway_channel_id, prize: prize.trim(), winnersCount: winnersCount || 1, endsAt, messageId: null });
    } catch {
      return { ok: false, code: "GIVEAWAY_CREATE_FAILED" };
    }
    let messageId = null;
    if (this.transport) {
      try {
        const msg = await this.transport.sendGiveaway({ guildId, channelId: giveaway.channel_id, prize: giveaway.prize, giveawayId: giveaway.id, endsAt });
        messageId = msg.id;
        // Update message_id in DB best-effort
        if (this.repository.updateMessageId) {
          await this.repository.updateMessageId(giveaway.id, messageId).catch(() => {});
        } else if (giveaway.message_id !== messageId) {
          // Fallback: try to update via supabase if available
          try {
            await this.repository.supabase.from("giveaways").update({ message_id: messageId }).eq("id", giveaway.id);
          } catch {}
        }
      } catch {}
    }
    if (this.logsRuntime && !this.logsRuntime.disabled) {
      try {
        await this.logsRuntime.handleModerationEvent({ guild: { id: guildId }, action: "giveaway_created", targetId: null });
      } catch {}
    }
    return { ok: true, code: "GIVEAWAY_CREATED", giveaway: { ...giveaway, message_id: messageId } };
  }

  async join({ guildId, giveawayId, userId }) {
    let giveaway;
    try {
      giveaway = await this.repository.findById(giveawayId);
    } catch {
      return { ok: false, code: "GIVEAWAY_NOT_FOUND" };
    }
    if (!giveaway || giveaway.guild_id !== guildId) return { ok: false, code: "GIVEAWAY_NOT_FOUND" };
    if (giveaway.status !== "open") return { ok: false, code: "GIVEAWAY_CLOSED" };
    try {
      const result = await this.repository.join(giveawayId, userId);
      if (result.alreadyJoined) return { ok: false, code: "GIVEAWAY_ALREADY_JOINED" };
      return { ok: true, code: "GIVEAWAY_JOINED", giveawayId, userId };
    } catch {
      return { ok: false, code: "GIVEAWAY_JOIN_FAILED" };
    }
  }

  async draw({ guildId, giveawayId }) {
    let giveaway;
    try {
      giveaway = await this.repository.findById(giveawayId);
    } catch {
      return { ok: false, code: "GIVEAWAY_NOT_FOUND" };
    }
    if (!giveaway || giveaway.guild_id !== guildId) return { ok: false, code: "GIVEAWAY_NOT_FOUND" };
    try {
      const { winners } = await this.repository.draw(giveawayId);
      await this.repository.close(giveawayId).catch(() => {});
      if (this.transport) {
        try {
          await this.transport.announceWinners({ guildId, channelId: giveaway.channel_id, prize: giveaway.prize, winners });
        } catch {}
      }
      if (this.logsRuntime && !this.logsRuntime.disabled) {
        try {
          await this.logsRuntime.handleModerationEvent({ guild: { id: guildId }, action: "giveaway_drawn", targetId: null });
        } catch {}
      }
      return { ok: true, code: "GIVEAWAY_DRAWN", winners };
    } catch {
      return { ok: false, code: "GIVEAWAY_DRAW_FAILED" };
    }
  }
}

module.exports = { GiveawayService };
