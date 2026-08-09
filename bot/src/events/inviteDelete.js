const { EmbedBuilder } = require("discord.js");
const guildConfigService = require("../services/guildConfig");
const inviteService = require("../services/inviteService");
const { fetchAuditLog } = require("../utils/auditLogCache");

module.exports = {
  name: "inviteDelete", once: false,
  async execute(invite) {
    const guildInvites = await invite.guild.invites.fetch().catch(() => null);
    if (guildInvites) inviteService.cacheGuildInvites(invite.guild.id, guildInvites);

    const config = await guildConfigService.getGuildConfig(invite.guild.id);
    if (!config?.logs_enabled || !config.invitations_enabled) return;
    const channelId = config.invitations_log_channel_id;
    if (!channelId) return;
    const logChannel = invite.client.channels.cache.get(channelId);
    if (!logChannel) return;

    let deletedBy = "Inconnu";
    try {
      const entry = await fetchAuditLog(invite.guild, 42);
      if (entry && Date.now() - entry.createdTimestamp < 10000) deletedBy = `${entry.executor}`;
    } catch {}

    const embed = new EmbedBuilder()
      .setColor("#ED4245").setTitle("🗑 INVITE DELETED")
      .setDescription(`🔗 **Code** • ${invite.code}\n📊 **Utilisations** • ${invite.uses || 0}\n🛡 **Par** • ${deletedBy}`)
      .setTimestamp();
    logChannel.send({ embeds: [embed] });
  },
};
