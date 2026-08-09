"use strict";
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require("discord.js");
class DiscordCaptchaTransport {
  constructor({ guild }) { this.guild = guild; }
  async sendPanel(channelId, view) {
    const channel = this.guild.channels.cache.get(channelId);
    if (!channel?.isTextBased()) throw new Error("captcha_channel_unavailable");
    const button = view.components[0];
    await channel.send({
      embeds: [new EmbedBuilder().setTitle(view.title).setDescription(view.content)],
      components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(button.customId).setLabel(button.label).setStyle(ButtonStyle.Success))],
    });
  }
}
module.exports = { DiscordCaptchaTransport };
