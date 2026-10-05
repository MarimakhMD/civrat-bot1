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

  async unassignRole(member, role) {
    await member.roles.remove(role);
  }

  /**
   * P-CAPT L2 — création d'un rôle provisionné. Le rôle est repositionné
   * sous le rôle le plus haut du bot (best-effort) : sans cela le rôle créé
   * en haut de la hiérarchie serait inexploitable (canManageRole strict).
   */
  async createRole(name) {
    const role = await this.guild.roles.create({ name, mentionable: false, hoist: false, reason: "CIVRAT Captcha provisioning" });
    const highest = this.guild.members.me?.roles?.highest;
    if (highest && typeof role.setPosition === "function" && role.position >= highest.position) {
      try {
        await role.setPosition(Math.max(1, highest.position - 1), "CIVRAT Captcha role hierarchy");
      } catch {
        // Hiérarchie non ajustable : l'attribut est peut-être impossible —
        // le contrôleur renverra un code clair plus tard.
      }
    }
    return role;
  }

  /**
   * P-CAPT L2 — recrée UNIQUEMENT le canal captcha manquant, avec le seul
   * overwrite nécessaire (lecture pour tous, aucune écriture membre).
   * Aucun autre salon ni permission globale n'est touché.
   */
  async createCaptchaChannel(name) {
    return this.guild.channels.create({
      name,
      type: 0,
      reason: "CIVRAT Captcha provisioning",
      permissionOverwrites: [{ id: this.guild.roles.everyone.id, deny: [PermissionsBitField.Flags.SendMessages] }],
    });
  }

  /**
   * P-CAPT L2 — applique l'overwrite du canal SI absent (jamais d'écrasement
   * d'un réglage déjà présent, jamais d'autre salon).
   */
  async ensureChannelControl(channelId) {
    const channel = this.guild.channels.cache.get(channelId);
    if (!channel || typeof channel.permissionOverwrites?.cache?.has !== "function") {
      return { ok: false, reason: "captcha.channelInvalid" };
    }
    const everyoneId = this.guild.roles.everyone.id;
    const existing = channel.permissionOverwrites.cache.get(everyoneId);
    if (existing && existing.deny?.has?.(PermissionsBitField.Flags.SendMessages)) {
      return { ok: true, changed: false };
    }
    if (existing) return { ok: true, changed: false, untouched: true };
    try {
      await channel.permissionOverwrites.edit(everyoneId, { SendMessages: false }, "CIVRAT Captcha channel control");
      return { ok: true, changed: true };
    } catch (error) {
      return { ok: false, reason: "captcha.channelPermissionsMissing", error: error?.message || String(error) };
    }
  }

  /** P-CAPT L2 — membre vu par le runtime (wrapper {id, roleIds, discordMember}). */
  wrapMember(member) {
    return { id: member.id, roleIds: [...member.roles.cache.keys()], discordMember: member };
  }

  /** P-CAPT L2 — échantillon borné de membres pour force-existing (best-effort). */
  async fetchMembers(limit) {
    try {
      const fetched = await this.guild.members.fetch();
      const all = [...fetched.values()];
      return all.slice(0, Math.max(0, limit));
    } catch (error) {
      throw new Error(`captcha_members_fetch_failed:${error?.message || String(error)}`);
    }
  }

  async sendStatusDM(discordMember, content) {
    await discordMember.user.send(content);
  }
}

module.exports = { DiscordCaptchaTransport };
