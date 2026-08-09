"use strict";

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder } = require("discord.js");

class DiscordTicketTransport {
  constructor({ guild }) { this.guild = guild; }

  async sendPanel(channelId, view) {
    const channel = this.guild.channels.cache.get(channelId);
    if (!channel?.isTextBased()) throw new Error("channel_unavailable");
    const button = view.components[0];
    await channel.send({
      embeds: [new EmbedBuilder().setTitle(view.title).setDescription(view.content)],
      components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(button.customId).setLabel(button.label).setStyle(ButtonStyle.Primary))],
    });
  }

  async getCategory(categoryId) {
    const category = this.guild.channels.cache.get(categoryId);
    return category?.type === ChannelType.GuildCategory ? category : null;
  }

  async getSupportRole(roleId) {
    return this.guild.roles.cache.get(roleId) || null;
  }

  async createTicketChannel({ category, member }) {
    return this.guild.channels.create({
      name: `ticket-${member.id}`,
      type: ChannelType.GuildText,
      parent: category.id,
    });
  }
}

module.exports = { DiscordTicketTransport };
