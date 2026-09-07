"use strict";

const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require("discord.js");

class DiscordGiveawayTransport {
  constructor({ guild }) {
    this.guild = guild;
  }

  /**
   * C1 : reçoit `title` (colonne réelle giveaways.title) et non plus `prize`.
   * L'option de commande s'appelle toujours `prize` ; le mapping est fait dans
   * register.js, donc aucun changement visible pour l'utilisateur.
   *
   * Aucun message_id n'est stocké : le bouton Join porte l'id de base du
   * giveaway, donc rien n'a besoin d'être retrouvé ensuite.
   */
  async sendGiveaway({ channelId, title, giveawayId, endsAt }) {
    const channel = this.guild.channels.cache.get(channelId);
    if (!channel || !channel.isTextBased()) throw new Error("channel_unavailable");
    const embed = new EmbedBuilder().setTitle("🎉 Giveaway").setDescription(`**${title}**\nEnds <t:${Math.floor(new Date(endsAt).getTime() / 1000)}:R>`).setColor("#5865f2");
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`giveaway_join:${giveawayId}`).setLabel("Join").setStyle(ButtonStyle.Primary));
    const msg = await channel.send({ embeds: [embed], components: [row] });
    return msg;
  }

  /**
   * Annonce les gagnants dans un message distinct.
   *
   * L'embed d'origine n'est PAS édité : giveaways n'a aucune colonne message_id
   * et le tirage est déclenché par une commande, donc aucun message cliqué
   * n'est disponible. Modifier l'embed d'origine exigerait une migration.
   */
  async announceWinners({ channelId, title, winners }) {
    const channel = this.guild.channels.cache.get(channelId);
    if (!channel || !channel.isTextBased()) return;
    const winnersMention = winners.length ? winners.map((id) => `<@${id}>`).join(", ") : "No participants";
    await channel.send({ content: `🎉 Giveaway **${title}** drawn! Winners: ${winnersMention}` }).catch(() => {});
  }
}

module.exports = { DiscordGiveawayTransport };
