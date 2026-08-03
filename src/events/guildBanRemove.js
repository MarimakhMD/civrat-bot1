const { EmbedBuilder } = require("discord.js");
const guildConfigService = require("../services/guildConfig");
const { fetchAuditLog } = require("../utils/auditLogCache");

module.exports = {
  name: "guildBanRemove", once: false,
  async execute(ban) {
    const config = await guildConfigService.getGuildConfig(ban.guild.id);
    if (!config?.logs_enabled) return;
    const channelId = config.log_moderation_channel_id;
    if (!channelId) return;
    const logChannel = ban.client.channels.cache.get(channelId);
    if (!logChannel) return;

    const entry = await fetchAuditLog(ban.guild, 23);
    const embed = new EmbedBuilder()
      .setColor("#57F287").setTitle("🔓 MEMBER UNBANNED")
      .setThumbnail(ban.user.displayAvatarURL())
      .setDescription(`👤 **Membre** • ${ban.user.tag}\n🆔 **ID** • ${ban.user.id}\n🛡 **Par** • ${entry?.executor || "Inconnu"}`)
      .setTimestamp();
    logChannel.send({ embeds: [embed] });
  },
};
