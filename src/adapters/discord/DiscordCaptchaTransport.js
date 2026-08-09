"use strict";
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require("discord.js");

class DiscordCaptchaTransport {
  constructor({ guild, member = null }) {
    this.guild = guild;
    this.member = member;
  }

  async sendPanel(channelId, view) {
    const channel = this.guild.channels.cache.get(channelId);
    if (!channel?.isTextBased()) throw new Error("captcha_channel_unavailable");
    const button = view.components[0];
    await channel.send({
      embeds: [new EmbedBuilder().setTitle(view.title).setDescription(view.content)],
      components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(button.customId).setLabel(button.label).setStyle(ButtonStyle.Success))],
    });
  }

  async getRole(roleId) {
    return this.guild.roles.cache.get(roleId) || null;
  }

  canManageRole(role) {
    const highest = this.guild.members.me?.roles.highest;
    return Boolean(role && !role.managed && highest && highest.position > role.position);
  }

  async assignRole(member, role) {
    await member.roles.add(role);
  }
}
module.exports = { DiscordCaptchaTransport };
