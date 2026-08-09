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
  const addedRoles = newMember.roles.cache.filter((role) => !oldMember.roles.cache.has(role.id));
  for (const role of addedRoles.values()) {
    await require("../modules/logs/runtime/getLogsRuntime")
      .getLogsRuntime()
      .handleRoleEvent({
        guild: newMember.guild,
        config,
        action: "member_role_added",
        roleId: role.id,
        memberId: newMember.id,
      });
  }

  const removedRoles = oldMember.roles.cache.filter((role) => !newMember.roles.cache.has(role.id));
  for (const role of removedRoles.values()) {
    await require("../modules/logs/runtime/getLogsRuntime")
      .getLogsRuntime()
      .handleRoleEvent({
        guild: newMember.guild,
        config,
        action: "member_role_removed",
        roleId: role.id,
        memberId: newMember.id,
      });
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
  const oldTimeout = oldMember.communicationDisabledUntilTimestamp;
  const newTimeout = newMember.communicationDisabledUntilTimestamp;

  if (oldTimeout === newTimeout) return;

  const action = !oldTimeout && newTimeout
    ? "member_timed_out"
    : oldTimeout && !newTimeout
      ? "member_untimeout"
      : null;

  if (!action) return;

  await require("../modules/logs/runtime/getLogsRuntime")
    .getLogsRuntime()
    .handleModerationEvent({
      guild: newMember.guild,
      config,
      action,
      targetId: newMember.id,
    });
}
