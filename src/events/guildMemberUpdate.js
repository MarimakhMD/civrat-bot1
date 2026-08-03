// ═══════════════════════════════════════════════════
// EVENT: guildMemberUpdate - Roles, Nickname, Timeout
// ═══════════════════════════════════════════════════
// FIX: Original had 2 separate listeners. Now merged.

const { EmbedBuilder } = require("discord.js");
const guildConfigService = require("../services/guildConfig");
const { fetchAuditLog } = require("../utils/auditLogCache");
const logger = require("../utils/logger");

module.exports = {
  name: "guildMemberUpdate",
  once: false,

  async execute(oldMember, newMember) {
    const config = await guildConfigService.getGuildConfig(newMember.guild.id);
    if (!config?.logs_enabled) return;

    await handleRoleChanges(oldMember, newMember, config);
    await handleNicknameChange(oldMember, newMember, config);
    await handleTimeout(oldMember, newMember, config);
  },
};

async function handleRoleChanges(oldMember, newMember, config) {
  const channelId = config.log_role_update_channel_id;
  if (!channelId) return;
  const channel = newMember.client.channels.cache.get(channelId);
  if (!channel) return;

  const addedRoles = newMember.roles.cache.filter((r) => !oldMember.roles.cache.has(r.id));
  for (const role of addedRoles.values()) {
    const entry = await fetchAuditLog(newMember.guild, 25);
    const embed = new EmbedBuilder()
      .setColor("#57F287").setTitle("🎖 ROLE ADDED")
      .setThumbnail(newMember.user.displayAvatarURL())
      .setDescription(`👤 **Membre** • ${newMember}\n🏷 **Rôle** • ${role}\n🛡 **Par** • ${entry?.executor || "Inconnu"}`)
      .setTimestamp();
    channel.send({ embeds: [embed] });
  }

  const removedRoles = oldMember.roles.cache.filter((r) => !newMember.roles.cache.has(r.id));
  for (const role of removedRoles.values()) {
    const entry = await fetchAuditLog(newMember.guild, 25);
    const embed = new EmbedBuilder()
      .setColor("#ED4245").setTitle("❌ ROLE REMOVED")
      .setThumbnail(newMember.user.displayAvatarURL())
      .setDescription(`👤 **Membre** • ${newMember}\n🏷 **Rôle** • ${role}\n🛡 **Par** • ${entry?.executor || "Inconnu"}`)
      .setTimestamp();
    channel.send({ embeds: [embed] });
  }
}

async function handleNicknameChange(oldMember, newMember, config) {
  if (oldMember.nickname === newMember.nickname) return;
  const channelId = config.log_role_update_channel_id;
  if (!channelId) return;
  const channel = newMember.client.channels.cache.get(channelId);
  if (!channel) return;

  const entry = await fetchAuditLog(newMember.guild, 24);
  const embed = new EmbedBuilder()
    .setColor("#FEE75C").setTitle("📝 NICKNAME CHANGED")
    .setThumbnail(newMember.user.displayAvatarURL())
    .setDescription(`👤 **Membre** • ${newMember}\n📛 **Avant** • ${oldMember.nickname || "Aucun"}\n📛 **Après** • ${newMember.nickname || "Aucun"}\n🛡 **Par** • ${entry?.executor || "Inconnu"}`)
    .setTimestamp();
  channel.send({ embeds: [embed] });
}

async function handleTimeout(oldMember, newMember, config) {
  const channelId = config.log_moderation_channel_id;
  if (!channelId) return;
  const channel = newMember.client.channels.cache.get(channelId);
  if (!channel) return;

  const oldTimeout = oldMember.communicationDisabledUntilTimestamp;
  const newTimeout = newMember.communicationDisabledUntilTimestamp;

  if (!oldTimeout && newTimeout) {
    const entry = await fetchAuditLog(newMember.guild, 24);
    const embed = new EmbedBuilder()
      .setColor("#FEE75C").setTitle("⏳ MEMBER TIMED OUT")
      .setThumbnail(newMember.user.displayAvatarURL())
      .setDescription(`👤 **Membre** • ${newMember}\n🆔 **ID** • ${newMember.id}\n🛡 **Par** • ${entry?.executor || "Inconnu"}\n📋 **Raison** • ${entry?.reason || "Aucune"}\n⏰ **Fin** • <t:${Math.floor(newTimeout / 1000)}:F>`)
      .setTimestamp();
    channel.send({ embeds: [embed] });
  }

  if (oldTimeout && !newTimeout) {
    const entry = await fetchAuditLog(newMember.guild, 24);
    const embed = new EmbedBuilder()
      .setColor("#57F287").setTitle("✅ MEMBER UNTIMEOUT")
      .setThumbnail(newMember.user.displayAvatarURL())
      .setDescription(`👤 **Membre** • ${newMember}\n🛡 **Par** • ${entry?.executor || "Inconnu"}`)
      .setTimestamp();
    channel.send({ embeds: [embed] });
  }
}
