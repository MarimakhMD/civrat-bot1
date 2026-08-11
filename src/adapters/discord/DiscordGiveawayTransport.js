"use strict";

const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require("discord.js");

class DiscordGiveawayTransport {
  constructor({ guild }) {
    this.guild = guild;
  }

  async sendGiveaway({ channelId, prize, giveawayId, endsAt }) {
    const channel = this.guild.channels.cache.get(channelId);
    if (!channel || !channel.isTextBased()) throw new Error("channel_unavailable");
    const embed = new EmbedBuilder().setTitle("🎉 Giveaway").setDescription(`**${prize}**\nEnds <t:${Math.floor(new Date(endsAt).getTime() / 1000)}:R>`).setColor("#5865f2");
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`giveaway_join:${giveawayId}`).setLabel("Join").setStyle(ButtonStyle.Primary));
    const msg = await channel.send({ embeds: [embed], components: [row] });
    return msg;
  }

  async announceWinners({ channelId, prize, winners }) {
    const channel = this.guild.channels.cache.get(channelId);
    if (!channel || !channel.isTextBased()) return;
    const winnersMention = winners.length ? winners.map((id) => `<@${id}>`).join(", ") : "No participants";
    await channel.send({ content: `🎉 Giveaway **${prize}** drawn! Winners: ${winnersMention}` }).catch(() => {});
  }
}

module.exports = { DiscordGiveawayTransport };
