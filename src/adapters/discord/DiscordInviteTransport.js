"use strict";

class DiscordInviteTransport {
  constructor({ guild }) {
    this.guild = guild;
  }

  async fetchInvites() {
    return this.guild.invites.fetch().catch(() => null);
  }

  async getMember(userId) {
    return this.guild.members.fetch(userId).catch(() => null);
  }
}

module.exports = { DiscordInviteTransport };
