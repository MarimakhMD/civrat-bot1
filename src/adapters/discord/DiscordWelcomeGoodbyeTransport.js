"use strict";
const { EmbedBuilder } = require("discord.js");

/**
 * Transport Discord du module Welcome/Goodbye.
 *
 * PHASE 2 (B8) — RÉSOLUTION DU SALON.
 *
 * L'ancienne version ne lisait QUE `guild.channels.cache` et levait un
 * `channel_unavailable` indifférencié. Trois réalités distinctes étaient donc
 * confondues, et un salon simplement absent du cache (redémarrage récent, salon
 * créé après la mise en cache) était traité comme supprimé :
 *   • aucun salon configuré            → CHANNEL_MISSING
 *   • salon introuvable / non textuel  → CHANNEL_NOT_FOUND
 *   • salon accessible mais interdit   → MISSING_PERMISSIONS
 *
 * Le repli `channels.fetch()` et le contrôle explicite `SendMessages` donnent un
 * motif exploitable au lieu d'un échec muet.
 *
 * PHASE 2 (B9) — `sendDirectMessage(userId, …)` utilisait systématiquement
 * `this.member.user`, en ignorant son argument. L'identifiant demandé est
 * désormais réellement utilisé, avec résolution depuis le cache du client puis
 * repli API.
 */
const WelcomeTransportReason = Object.freeze({
  CHANNEL_MISSING: "CHANNEL_MISSING",
  CHANNEL_NOT_FOUND: "CHANNEL_NOT_FOUND",
  MISSING_PERMISSIONS: "MISSING_PERMISSIONS",
  USER_UNAVAILABLE: "USER_UNAVAILABLE",
});

function transportError(message, reason) {
  const error = new Error(message);
  error.reason = reason;
  return error;
}

class DiscordWelcomeGoodbyeTransport {
  constructor(member) {
    this.member = member;
  }

  async #resolveChannel(channelId) {
    if (!channelId) throw transportError("channel_missing", WelcomeTransportReason.CHANNEL_MISSING);
    const guild = this.member && this.member.guild;
    if (!guild || !guild.channels) throw transportError("channel_not_found", WelcomeTransportReason.CHANNEL_NOT_FOUND);

    let channel = guild.channels.cache ? guild.channels.cache.get(channelId) : null;
    // Repli API : absent du cache ne veut pas dire inexistant.
    if (!channel && typeof guild.channels.fetch === "function") {
      channel = await guild.channels.fetch(channelId).catch(() => null);
    }
    if (!channel || typeof channel.isTextBased !== "function" || !channel.isTextBased()) {
      throw transportError("channel_not_found", WelcomeTransportReason.CHANNEL_NOT_FOUND);
    }

    const me = guild.members && guild.members.me ? guild.members.me : null;
    if (me && typeof channel.permissionsFor === "function") {
      const permissions = channel.permissionsFor(me);
      if (permissions && typeof permissions.has === "function" && !permissions.has("SendMessages")) {
        throw transportError("missing_permissions", WelcomeTransportReason.MISSING_PERMISSIONS);
      }
    }
    return channel;
  }

  async sendChannelMessage(channelId, payload) {
    const channel = await this.#resolveChannel(channelId);
    const options = payload.embed
      ? { embeds: [new EmbedBuilder().setColor(payload.embed.color || "#5865f2").setDescription(payload.embed.description)] }
      : { content: payload.content };
    if (Array.isArray(payload.files) && payload.files.length) options.files = payload.files;
    return channel.send(options);
  }

  async #resolveUser(targetId) {
    const own = this.member && this.member.user;
    if (own && own.id === targetId) return own;
    const client = this.member && this.member.guild ? this.member.guild.client : null;
    if (!client || !client.users) return null;
    const cached = client.users.cache ? client.users.cache.get(targetId) : null;
    if (cached) return cached;
    if (typeof client.users.fetch === "function") {
      return client.users.fetch(targetId).catch(() => null);
    }
    return null;
  }

  async sendDirectMessage(userId, payload) {
    const targetId = userId || (this.member && this.member.id) || null;
    if (!targetId) throw transportError("user_unavailable", WelcomeTransportReason.USER_UNAVAILABLE);
    const user = await this.#resolveUser(targetId);
    if (!user) throw transportError("user_unavailable", WelcomeTransportReason.USER_UNAVAILABLE);
    return user.send({ content: payload.content });
  }
}

module.exports = { DiscordWelcomeGoodbyeTransport, WelcomeTransportReason };
