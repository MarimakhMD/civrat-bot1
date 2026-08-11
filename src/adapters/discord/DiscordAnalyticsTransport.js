"use strict";

const { EmbedBuilder } = require("discord.js");

class DiscordAnalyticsTransport {
  constructor({ guild }) {
    this.guild = guild;
  }

  async sendStats({ channelId, stats, topXP, topInvites }) {
    const channel = this.guild.channels.cache.get(channelId);
    if (!channel || !channel.isTextBased()) throw new Error("channel_unavailable");
    const lines = [
      `**Messages:** ${stats.messages}`,
      `**Members:** ${stats.members}`,
      `**Top XP:** ${topXP.map((e, i) => `${i + 1}. <@${e.userId}> ${e.xp} XP`).join(", ") || "None"}`,
      `**Top Invites:** ${topInvites.map((e, i) => `${i + 1}. <@${e.userId}> ${e.current}`).join(", ") || "None"}`,
    ];
    const embed = new EmbedBuilder().setTitle("📊 Analytics").setDescription(lines.join("\n")).setColor("#5865f2");
    return channel.send({ embeds: [embed] });
  }
}

module.exports = { DiscordAnalyticsTransport };
