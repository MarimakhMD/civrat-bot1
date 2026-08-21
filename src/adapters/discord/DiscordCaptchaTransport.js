"use strict";

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionsBitField } = require("discord.js");

class DiscordCaptchaTransport {
  constructor({ guild, member = null }) {
    this.guild = guild;
    this.member = member;
  }

  // Envoie le panel persistant et retourne le message envoyé (pour le
  // dédoublonnage des panels côté hébergement).
  async sendPanel(channelId, view) {
    const channel = this.guild.channels.cache.get(channelId);
    if (!channel?.isTextBased()) throw new Error("captcha_channel_unavailable");
    const button = view.components[0];
    return channel.send({
      embeds: [new EmbedBuilder().setTitle(view.title).setDescription(view.content)],
      components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(button.customId).setLabel(button.label).setStyle(ButtonStyle.Success))],
    });
  }

  // Supprime un ancien panel (best-effort, jamais bloquant).
  async deletePanel(channelId, messageId) {
    if (!messageId) return;
    const channel = this.guild.channels.cache.get(channelId);
    if (!channel?.isTextBased()) return;
    try {
      const message = await channel.messages.fetch(messageId);
      if (message?.deletable) await message.delete();
    } catch {
      // message déjà supprimé / permissions manquantes : sans gravité
    }
  }

  // Validation au moment de la sélection : salon textuel + permissions du bot.
  async validateChannel(channelId) {
    const channel = this.guild.channels.cache.get(channelId);
    if (!channel?.isTextBased()) return { ok: false, reason: "captcha.channelInvalid" };
    const permissions = channel.permissionsFor(this.guild.members.me);
    const canPost = permissions?.has([PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages]);
    if (!canPost) return { ok: false, reason: "captcha.channelPermissionsMissing" };
    return { ok: true };
  }

  // Validation au moment de la sélection : rôle existant + attribuable par le bot.
  async validateRole(roleId) {
    const role = this.guild.roles.cache.get(roleId);
    if (!role) return { ok: false, reason: "captcha.roleMissing" };
    if (!this.canManageRole(role)) return { ok: false, reason: "captcha.roleUnmanageable" };
    return { ok: true };
  }

  async sendReminder(member, payload) {
    await member.user.send(payload);
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
