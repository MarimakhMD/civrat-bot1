// ═══════════════════════════════════════════════════
// EVENT: guildMemberAdd - Welcome, AutoRole, Invites, Anti-Raid
// ═══════════════════════════════════════════════════
// FIX: Original had 3 separate listeners. Now merged into one.

const { EmbedBuilder } = require("discord.js");
const guildConfigService = require("../services/guildConfig");
const inviteService = require("../services/inviteService");
const logger = require("../utils/logger");
const securityService = require("../services/securityService");
const { sendLog } = require("../services/logService");
const captchaService = require("../services/captchaService");

module.exports = {
  name: "guildMemberAdd",
  once: false,

  async execute(member) {
    const config = await guildConfigService.getGuildConfig(member.guild.id);
    if (!config) return;

    // 1. Auto Role
    await require("../modules/autorole/runtime/getAutoRoleRuntime").getAutoRoleRuntime().handleMemberJoined(member);
    // 2. Welcome Message
    await require("../runtime/getWelcomeGoodbyeRuntime").getWelcomeGoodbyeRuntime().handleMemberAdded(member);
    // 3. Captcha reminder (best effort; DMs can be closed)
    await captchaService.sendReminder(member, config);
    // 4. Invite Tracking
    const inviteResult = await handleInviteTracking(member, config);
    await handleInviteJoinLog(member, config, inviteResult);
    // 4. Join Log
    await require("../modules/logs/runtime/getLogsRuntime").getLogsRuntime().handleMemberJoined(member);
    // 5. Security Center
    await securityService.recordRaidJoin(member, config);
    await securityService.handleBotJoin(member, config);
  },
};

async function handleInviteTracking(member, config) {
  if (member.user.bot) return null;

  try {
    if (!inviteService.hasCachedGuild(member.guild.id)) {
      // First join after a restart cannot be attributed reliably; prime cache for subsequent joins.
      await inviteService.refreshGuildInvites(member.guild);
      return null;
    }
    const newInvites = await member.guild.invites.fetch().catch(() => null);
    const result = inviteService.findUsedInvite(member.guild.id, newInvites);

    if (result?.inviter) {
      await inviteService.addInvite(result.inviter.id, member.guild.id);
      await inviteService.setInvitedBy(member.id, member.guild.id, result.inviter.id);
    }

    return result;
  } catch (err) {
    logger.error(`Invite tracking failed for ${member.user.tag}:`, err.message);
    return null;
  }
}


async function handleInviteJoinLog(member, config, inviteResult) {
  if (!inviteResult?.inviter) return;
  await require("../modules/logs/runtime/getLogsRuntime").getLogsRuntime().handleInviteEvent({
    guild: member.guild, config, action: "invite_used", inviteCode: inviteResult.code,
  });
}

async function handleJoinLog(member, config, inviteResult) {
  if (!config.logs_enabled) return;

  const channelId = config.log_member_join_channel_id;
  if (!channelId) return;

  const channel = member.client.channels.cache.get(channelId);
  if (!channel) return;

  try {
    const inviterStats = inviteResult?.inviter
      ? await inviteService.getInviteStats(inviteResult.inviter.id, member.guild.id)
      : null;

    const embed = new EmbedBuilder()
      .setColor("#57F287")
      .setTitle("📥 MEMBER JOINED")
      .setThumbnail(member.user.displayAvatarURL())
      .setDescription(
        `━━━━━━━━━━━━━━━━━━━━━━\n👤 **Membre** • ${member}\n🆔 **ID** • ${member.id}\n📆 **Compte créé** • <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>\n🔗 **Invitation** • ${inviteResult?.code || "Inconnue"}\n🛡 **Invité par** • ${inviteResult?.inviter || "Inconnu"}\n📊 **Invitations du recruteur** • ${inviterStats?.current || 0}\n👥 **Membres** • ${member.guild.memberCount}\n━━━━━━━━━━━━━━━━━━━━━━`
      )
      .setFooter({ text: member.guild.name })
      .setTimestamp();

    channel.send({ embeds: [embed] });
  } catch (err) {
    logger.error(`Join log failed:`, err.message);
  }
}
