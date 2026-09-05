"use strict";

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, PermissionsBitField } = require("discord.js");
// M8 — rendu générique des composants (emoji, styles, packing 5×5, garde-fou
// des 5 lignes d'action). rows() est déjà exporté par DiscordResponseTransport
// et utilisé par tout le reste du bot : le panel suit enfin le même chemin.
const { rows } = require("./DiscordResponseTransport");

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

  /**
   * M8 — envoie le panel et RENVOIE le message Discord.
   *
   * Avant M8 cette fonction ne renvoyait rien : le messageId était perdu, donc
   * aucun panel ne pouvait être retrouvé, édité, invalidé ou dédoublonné.
   *
   * Le rendu passe désormais par rows() (DiscordResponseTransport) au lieu
   * d'une ActionRowBuilder construite à la main :
   *   - tous les composants sont rendus, plus seulement components[0] ;
   *   - emoji et style sont honorés (avant : style forcé à Primary, emoji jeté) ;
   *   - le packing 5 boutons × 5 lignes est celui du reste du bot ;
   *   - rows() LÈVE au-delà de 5 lignes, ce qui borne structurellement un panel.
   *
   * Phase 10.2 inchangé : sans view.embed (Free), l'embed n'a ni couleur ni
   * image et le payload reste identique à l'historique.
   */
  async sendPanel(channelId, view) {
    const channel = this.guild.channels.cache.get(channelId);
    if (!channel?.isTextBased()) throw new Error("channel_unavailable");
    return channel.send({ embeds: [this._panelEmbed(view)], components: rows(view.components || []) });
  }

  /**
   * M8 — édite le message d'un panel déjà publié.
   *
   * Lève `panel_message_not_found` si le message a disparu (suppression
   * manuelle, salon purgé) : c'est le signal qui déclenche la réconciliation
   * paresseuse côté service — la ligne passe à is_active = false.
   *
   * Lève `channel_unavailable` si le salon lui-même a disparu.
   */
  async editPanel(channelId, messageId, view) {
    if (!messageId) throw new Error("panel_message_not_found");
    const channel = this.guild.channels.cache.get(channelId);
    if (!channel?.isTextBased()) throw new Error("channel_unavailable");
    let message;
    try {
      message = await channel.messages.fetch(messageId);
    } catch (_error) {
      throw new Error("panel_message_not_found");
    }
    if (!message) throw new Error("panel_message_not_found");
    return message.edit({ embeds: [this._panelEmbed(view)], components: rows(view.components || []) });
  }

  /**
   * M8 — suppression BEST-EFFORT du message d'un panel.
   *
   * Ne lève JAMAIS : la base fait foi (is_active = false). Un message qui n'a
   * pas pu être supprimé reste cliquable, mais son bouton retombe sur
   * TICKET_PANEL_UNAVAILABLE puisque le panel est inactif.
   */
  async deletePanel(channelId, messageId) {
    if (!channelId || !messageId) return { deleted: false };
    try {
      const channel = this.guild.channels.cache.get(channelId);
      if (!channel?.isTextBased()) return { deleted: false };
      const message = await channel.messages.fetch(messageId);
      if (!message) return { deleted: false };
      await message.delete();
      return { deleted: true };
    } catch (_error) {
      return { deleted: false };
    }
  }

  _panelEmbed(view) {
    const embed = new EmbedBuilder().setTitle(view.title).setDescription(view.content);
    if (view.embed?.color) embed.setColor(view.embed.color);
    if (view.embed?.image) embed.setImage(view.embed.image);
    return embed;
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

  // C9 — §12 : AUCUN repli ticket-<userId>. Le nom est résolu en amont par
  // TicketService (format Premium {number} ou nommage Free atomique
  // ticket-001 via la RPC increment_ticket_counter). Sans nom valide on lève
  // AVANT tout appel Discord : pas de salon orphelin, pas de nommage
  // interdit, et l'appelant retourne TICKET_NAME_UNAVAILABLE.
  async createTicketChannel({ category, member, name = null }) {
    if (typeof name !== "string" || name.trim() === "") throw new Error("ticket_name_unavailable");
    return this.guild.channels.create({
      name,
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

  // P15 — notices post-action (fermeture/réouverture) du moteur Tickets.
  // Composants optionnels : la notice de réouverture n'en embarque aucun.
  // Styles connus : danger/success/primary ; repli Secondary sinon.
  async sendTicketNotice(channelId, view) {
    const channel = this.guild.channels.cache.get(channelId);
    if (!channel?.isTextBased()) throw new Error("ticket_channel_unavailable");
    const styles = { danger: ButtonStyle.Danger, success: ButtonStyle.Success, primary: ButtonStyle.Primary };
    const buttons = (view.components || []).map((component) => new ButtonBuilder()
      .setCustomId(component.customId)
      .setLabel(component.label)
      .setStyle(styles[component.style] || ButtonStyle.Secondary));
    return channel.send({
      embeds: [new EmbedBuilder().setDescription(view.description)],
      components: buttons.length ? [new ActionRowBuilder().addComponents(buttons)] : [],
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
