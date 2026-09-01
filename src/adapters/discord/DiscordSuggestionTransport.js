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

  /**
   * C2 — Met à jour l'embed de la suggestion.
   *
   * Le message n'est plus retrouvé via `suggestion.message_id` /
   * `suggestion.channel_id` : ces colonnes n'existent pas dans public.suggestions
   * et l'ancienne garde `if (!suggestion.message_id || !suggestion.channel_id)
   * return;` faisait donc systématiquement sortir — les compteurs de votes
   * n'étaient JAMAIS rafraîchis à l'écran.
   *
   * À la place on édite le message réellement cliqué, fourni par l'enveloppe
   * d'interaction (DiscordInteractionAdapter → `message`). Un clic de bouton
   * porte toujours son message d'origine : aucune donnée à stocker.
   */
  async updateSuggestion({ suggestion, message = null }) {
    if (!message || typeof message.edit !== "function") return;
    try {
      const embed = new EmbedBuilder()
        .setTitle("💡 Suggestion")
        .setDescription(suggestion.content)
        .setFooter({ text: `👍 ${suggestion.upvotes || 0} | 👎 ${suggestion.downvotes || 0} | ${suggestion.status}` })
        .setColor("#5865f2");
      await message.edit({ embeds: [embed] }).catch(() => {});
    } catch {}
  }

  /** C2 — Supprime le message cliqué ; même principe qu'updateSuggestion. */
  async deleteSuggestion({ message = null }) {
    if (!message || typeof message.delete !== "function") return;
    try {
      await message.delete().catch(() => {});
    } catch {}
  }
}

module.exports = { DiscordSuggestionTransport };
