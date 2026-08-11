"use strict";

class DiscordTempVoiceTransport {
  constructor({ guild }) {
    this.guild = guild;
  }

  async createChannel({ name, parentId, userId }) {
    const channel = await this.guild.channels.create({
      name,
      type: 2, // GuildVoice
      parent: parentId || null,
      permissionOverwrites: userId
        ? [
            {
              id: userId,
              allow: ["ManageChannels", "MoveMembers", "MuteMembers", "DeafenMembers"],
            },
          ]
        : [],
    });
    return channel;
  }

  async deleteChannel(channelId) {
    const channel = this.guild.channels.cache.get(channelId);
    if (!channel) return false;
    await channel.delete().catch(() => null);
    return true;
  }

  async moveMember(member, channelId) {
    const channel = this.guild.channels.cache.get(channelId);
    if (!channel) return false;
    await member.voice.setChannel(channel).catch(() => null);
    return true;
  }

  async isEmpty(channelId) {
    const channel = this.guild.channels.cache.get(channelId);
    if (!channel) return true;
    // Discord.js: channel.members is Collection of members in voice
    const members = channel.members;
    if (!members) return true;
    return members.size === 0;
  }
}

module.exports = { DiscordTempVoiceTransport };
