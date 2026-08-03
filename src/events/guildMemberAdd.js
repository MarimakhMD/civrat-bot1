// ═══════════════════════════════════════════════════
// EVENT: guildMemberAdd - Welcome, AutoRole, Invites, Anti-Raid
// ═══════════════════════════════════════════════════
// FIX: Original had 3 separate listeners. Now merged into one.

const { EmbedBuilder } = require("discord.js");
const guildConfigService = require("../services/guildConfig");
const inviteService = require("../services/inviteService");
const welcomeService = require("../services/welcomeService");
const logger = require("../utils/logger");
const securityService = require("../services/securityService");
const { sendLog } = require("../services/logService");
const captchaService = require("../services/captchaService");

// Anti-raid tracking per guild
const joinTracker = new Map();

module.exports = {
  name: "guildMemberAdd",
  once: false,

  async execute(member) {
    const config = await guildConfigService.getGuildConfig(member.guild.id);
    if (!config) return;

    // 1. Auto Role
    await handleAutoRole(member, config);
    // 2. Welcome Message
    await handleWelcome(member, config);
    // 3. Captcha reminder (best effort; DMs can be closed)
    await captchaService.sendReminder(member, config);
    // 4. Invite Tracking
    const inviteResult = await handleInviteTracking(member, config);
    await handleInviteJoinLog(member, config, inviteResult);
    // 4. Join Log
    await handleJoinLog(member, config, inviteResult);
    // 5. Security Center
    await securityService.recordRaidJoin(member, config);
    await securityService.handleBotJoin(member, config);
  },
};

async function handleAutoRole(member, config) {
  // Use hardcoded roles as fallback (from original bot)
  const MEMBER_ROLE = "1320817768962064385";
  const BOT_ROLE = "1320817768962064387";

  try {
    if (member.user.bot) {
      await member.roles.add(BOT_ROLE).catch(() => {});
    } else {
      await member.roles.add(MEMBER_ROLE).catch(() => {});
    }
  } catch (err) {
    logger.error(`AutoRole failed for ${member.user.tag}:`, err.message);
  }
}

async function handleWelcome(member, config) {
  await welcomeService.sendWelcome(member, config);
  await welcomeService.sendWelcomeDm(member, config);
}

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
  if (!config.invitations_enabled || !inviteResult?.inviter) return;
  const stats = await inviteService.getInviteStats(inviteResult.inviter.id, member.guild.id);
  await sendLog(member.guild, config, "invitations_log_channel_id", {
    title: "🔗 Invitation utilisée", color: "success", target: `${member.user} (${member.id})`, moderator: inviteResult.inviter,
    fields: [{ name: "Code", value: inviteResult.code || "Inconnu", inline: true }, { name: "Invitations nettes", value: String(stats.net), inline: true }],
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
