const { EmbedBuilder } = require("discord.js");
const guildConfigService = require("../services/guildConfig");
const inviteService = require("../services/inviteService");

module.exports = {
  name: "inviteCreate", once: false,
  async execute(invite) {
    const guildInvites = await invite.guild.invites.fetch().catch(() => null);
    if (guildInvites) inviteService.cacheGuildInvites(invite.guild.id, guildInvites);

    const config = await guildConfigService.getGuildConfig(invite.guild.id);
    if (!config?.logs_enabled || !config.invitations_enabled) return;
    const channelId = config.invitations_log_channel_id;
    if (!channelId) return;
    const logChannel = invite.client.channels.cache.get(channelId);
    if (!logChannel) return;

    const embed = new EmbedBuilder()
      .setColor("#00D4AA").setTitle("🔗 INVITE CREATED")
      .setThumbnail(invite.inviter?.displayAvatarURL() || null)
      .setDescription(`👤 **Par** • ${invite.inviter || "Inconnu"}\n🎫 **Code** • ${invite.code}\n📍 **Salon** • <#${invite.channel?.id || "0"}>\n📊 **Max** • ${invite.maxUses || "Illimité"}`)
      .setTimestamp();
    logChannel.send({ embeds: [embed] });
  },
};
