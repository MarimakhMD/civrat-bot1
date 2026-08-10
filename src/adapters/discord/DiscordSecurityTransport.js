"use strict";

/**
 * Discord transport for Security. Only depends on Discord.js guild/member API.
 * No business logic, only Discord effects and capability checks.
 */
class DiscordSecurityTransport {
  constructor({ guild }) {
    this.guild = guild;
  }

  async fetchMember(targetId) {
    if (!targetId) return null;
    return this.guild.members.fetch(targetId).catch(() => null);
  }

  isModeratable(member) {
    return Boolean(member && member.moderatable);
  }

  isBot(member) {
    return Boolean(member && member.user && member.user.bot);
  }

  async fetchChannel(channelId) {
    if (!channelId) return null;
    return this.guild.channels.cache.get(channelId) || null;
  }
}

module.exports = { DiscordSecurityTransport };
