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
    // Phase 10.2 : les personnalisations Premium couleur/image n'arrivent que
    // si le resolver a autorisé Premium. Sans view.embed (Free), le payload
    // envoyé est strictement identique à l'historique.
    const embed = new EmbedBuilder().setTitle(view.title).setDescription(view.content);
    if (view.embed?.color) embed.setColor(view.embed.color);
    if (view.embed?.image) embed.setImage(view.embed.image);
    await channel.send({
      embeds: [embed],
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

  async createTicketChannel({ category, member, name = null }) {
    return this.guild.channels.create({
      // Phase 10.4 : name = nom Premium résolu par TicketService ; absent =>
      // nommage Free historique ticket-<userId>, strictement inchangé.
      name: name || `ticket-${member.id}`,
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

  async claimTicketChannel(channelId, ownerId, claimantId) {
    const channel = this.guild.channels.cache.get(channelId);
    if (!channel?.isTextBased() || !channel.manageable) return { claimed: false, code: "TICKET_CLAIM_FAILED" };
    try { await channel.setTopic(`civrat-ticket:${ownerId}:${claimantId}`); return { claimed: true, code: "TICKET_CHANNEL_CLAIMED" }; } catch (_error) { return { claimed: false, code: "TICKET_CLAIM_FAILED" }; }
  }

  async fetchTranscriptMessages(channelId) {
    const channel = this.guild.channels.cache.get(channelId);
    if (!channel?.isTextBased()) throw new Error("ticket_channel_unavailable");
    const messages = await channel.messages.fetch({ limit: 100 });
    return [...messages.values()].map((message) => ({ timestamp: message.createdAt.toISOString(), author: message.author.tag, content: message.content }));
  }

  async sendTranscript({ channelId, logChannelId, content }) {
    const channel = this.guild.channels.cache.get(channelId);
    const destination = this.guild.channels.cache.get(logChannelId);
    if (!channel?.isTextBased() || !destination?.isTextBased()) throw new Error("transcript_destination_unavailable");
    const attachment = new (require("discord.js").AttachmentBuilder)(Buffer.from(content, "utf8"), { name: `transcript-${channelId}.txt` });
    await destination.send({ content: `📄 Transcript de ${channel} (100 derniers messages maximum).`, files: [attachment] });
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

  async deleteTicketChannel(channelId) {
    const channel = this.guild.channels.cache.get(channelId);
    if (!channel?.isTextBased() || !channel.deletable) return { deleted: false, code: "TICKET_DELETE_FAILED" };
    try {
      await channel.delete("CIVRAT ticket deleted");
      return { deleted: true, code: "TICKET_CHANNEL_DELETED" };
    } catch (_error) {
      return { deleted: false, code: "TICKET_DELETE_FAILED" };
    }
  }

  async renameTicketChannel(channelId, name) {
    const channel = this.guild.channels.cache.get(channelId);
    if (!channel?.isTextBased() || !channel.manageable) return { renamed: false, code: "TICKET_RENAME_FAILED" };
    try {
      await channel.setName(name, "CIVRAT ticket renamed");
      return { renamed: true, code: "TICKET_CHANNEL_RENAMED" };
    } catch (_error) {
      return { renamed: false, code: "TICKET_RENAME_FAILED" };
    }
  }

  async getGuildMember(memberId) { return this.guild.members.cache.get(memberId) || null; }

  async addTicketMemberAccess(channelId, member) {
    const channel = this.guild.channels.cache.get(channelId);
    if (!channel?.isTextBased() || !channel.manageable) return { changed: false, code: "TICKET_MEMBER_ACCESS_FAILED" };
    if (channel.permissionOverwrites.cache.has(member.id)) return { changed: false, code: "TICKET_MEMBER_ALREADY_ADDED" };
    try {
      await channel.permissionOverwrites.edit(member.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }, "CIVRAT ticket member added");
      return { changed: true, code: "TICKET_MEMBER_ADDED" };
    } catch (_error) { return { changed: false, code: "TICKET_MEMBER_ACCESS_FAILED" }; }
  }

  async removeTicketMemberAccess(channelId, memberId) {
    const channel = this.guild.channels.cache.get(channelId);
    if (!channel?.isTextBased() || !channel.manageable) return { changed: false, code: "TICKET_MEMBER_ACCESS_FAILED" };
    if (!channel.permissionOverwrites.cache.has(memberId)) return { changed: false, code: "TICKET_MEMBER_NOT_ADDED" };
    try {
      await channel.permissionOverwrites.delete(memberId, "CIVRAT ticket member removed");
      return { changed: true, code: "TICKET_MEMBER_REMOVED" };
    } catch (_error) { return { changed: false, code: "TICKET_MEMBER_ACCESS_FAILED" }; }
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
