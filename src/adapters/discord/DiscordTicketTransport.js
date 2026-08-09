"use strict";

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, PermissionsBitField } = require("discord.js");

const TicketChannelPermissions = Object.freeze([
  PermissionsBitField.Flags.ViewChannel,
  PermissionsBitField.Flags.SendMessages,
  PermissionsBitField.Flags.ReadMessageHistory,
]);
const BotTicketChannelPermissions = Object.freeze([
  ...TicketChannelPermissions,
  PermissionsBitField.Flags.ManageChannels,
]);

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

  async getMember(memberId) {
    return this.guild.members.cache.get(memberId) || null;
  }

  async getBotMember() {
    return this.guild.members.me || null;
  }

  async createTicketChannel({ category, member }) {
    return this.guild.channels.create({
      name: `ticket-${member.id}`,
      type: ChannelType.GuildText,
      parent: category.id,
    });
  }

  async sendTicketWelcome(channel, view) {
    if (!channel?.isTextBased()) throw new Error("ticket_channel_unavailable");
    const components = view.components.map((component) => new ButtonBuilder()
      .setCustomId(component.customId)
      .setLabel(component.label)
      .setStyle(component.style === "danger" ? ButtonStyle.Danger : ButtonStyle.Secondary));
    return channel.send({
      embeds: [new EmbedBuilder().setTitle(view.title).setDescription(view.description).addFields(view.fields)],
      components: [new ActionRowBuilder().addComponents(components)],
    });
  }

  async isMemberInRole(member, roleId) {
    return Boolean(member?.roles?.cache?.has(roleId));
  }

  async closeTicketChannel(channelId, ownerId) {
    const channel = this.guild.channels.cache.get(channelId);
    if (!channel?.isTextBased() || !channel.manageable) return { closed: false, code: "TICKET_CLOSE_FAILED" };
    try {
      await channel.permissionOverwrites.edit(ownerId, { SendMessages: false }, "CIVRAT ticket closed");
      return { closed: true, code: "TICKET_CHANNEL_CLOSED" };
    } catch (_error) {
      return { closed: false, code: "TICKET_CLOSE_FAILED" };
    }
  }

  async reopenTicketChannel(channelId, ownerId) {
    const channel = this.guild.channels.cache.get(channelId);
    if (!channel?.isTextBased() || !channel.manageable) return { reopened: false, code: "TICKET_REOPEN_FAILED" };
    try {
      await channel.permissionOverwrites.edit(ownerId, { SendMessages: true }, "CIVRAT ticket reopened");
      return { reopened: true, code: "TICKET_CHANNEL_REOPENED" };
    } catch (_error) {
      return { reopened: false, code: "TICKET_REOPEN_FAILED" };
    }
  }

  async applyTicketOverwrites({ channel, member, supportRole, botMember }) {
    if (!channel) return { applied: false, code: "TICKET_CHANNEL_MISSING" };
    if (!member) return { applied: false, code: "TICKET_MEMBER_MISSING" };
    if (!supportRole) return { applied: false, code: "TICKET_CONFIG_INCOMPLETE" };
    if (!botMember) return { applied: false, code: "TICKET_BOT_MISSING" };
    if (!channel.manageable) return { applied: false, code: "TICKET_PERMISSION_INSUFFICIENT" };
    try {
      await channel.permissionOverwrites.set([
        { id: this.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: member.id, allow: TicketChannelPermissions },
        { id: supportRole.id, allow: TicketChannelPermissions },
        { id: botMember.id, allow: BotTicketChannelPermissions },
      ], "CIVRAT ticket channel permissions");
      return { applied: true, code: "TICKET_OVERWRITES_APPLIED" };
    } catch (_error) {
      return { applied: false, code: "TICKET_OVERWRITE_FAILED" };
    }
  }
}

module.exports = { DiscordTicketTransport, TicketChannelPermissions, BotTicketChannelPermissions };
