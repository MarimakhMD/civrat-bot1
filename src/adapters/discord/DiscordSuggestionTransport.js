"use strict";

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

class DiscordSuggestionTransport {
  constructor({ guild }) {
    this.guild = guild;
  }

  async sendSuggestion({ channelId, suggestionId, content, authorId }) {
    const channel = this.guild.channels.cache.get(channelId);
    if (!channel || !channel.isTextBased()) throw new Error("channel_unavailable");
    const embed = new EmbedBuilder().setTitle("💡 Suggestion").setDescription(content).setFooter({ text: `By <@${authorId}>` }).setColor("#5865f2");
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`suggestion_up:${suggestionId}`).setLabel("👍").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`suggestion_down:${suggestionId}`).setLabel("👎").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`suggestion_approve:${suggestionId}`).setLabel("Approve").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`suggestion_reject:${suggestionId}`).setLabel("Reject").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`suggestion_delete:${suggestionId}`).setLabel("Delete").setStyle(ButtonStyle.Danger)
    );
    const msg = await channel.send({ embeds: [embed], components: [row] });
    return msg;
  }

  async updateSuggestion({ suggestion }) {
    if (!suggestion.message_id || !suggestion.channel_id) return;
    const channel = this.guild.channels.cache.get(suggestion.channel_id);
    if (!channel || !channel.isTextBased()) return;
    try {
      const msg = await channel.messages.fetch(suggestion.message_id).catch(() => null);
      if (!msg) return;
      const embed = new EmbedBuilder().setTitle("💡 Suggestion").setDescription(suggestion.content).setFooter({ text: `👍 ${suggestion.up_votes || 0} | 👎 ${suggestion.down_votes || 0} | ${suggestion.status}` }).setColor("#5865f2");
      await msg.edit({ embeds: [embed] }).catch(() => {});
    } catch {}
  }

  async deleteSuggestion({ suggestion }) {
    if (!suggestion.message_id || !suggestion.channel_id) return;
    const channel = this.guild.channels.cache.get(suggestion.channel_id);
    if (!channel) return;
    try {
      const msg = await channel.messages.fetch(suggestion.message_id).catch(() => null);
      if (msg) await msg.delete().catch(() => {});
    } catch {}
  }
}

module.exports = { DiscordSuggestionTransport };
