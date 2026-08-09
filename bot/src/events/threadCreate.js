const { EmbedBuilder } = require("discord.js");
const guildConfigService = require("../services/guildConfig");

module.exports = {
  name: "threadCreate", once: false,
  async execute(thread) {
    const config = await guildConfigService.getGuildConfig(thread.guild.id);
    if (!config?.logs_enabled) return;
    const channelId = config.log_channel_update_channel_id;
    if (!channelId) return;
    const logChannel = thread.client.channels.cache.get(channelId);
    if (!logChannel) return;

    const embed = new EmbedBuilder()
      .setColor("#00D4AA").setTitle("🧵 THREAD CREATED")
      .setDescription(`🧵 **Nom** • ${thread.name}\n🆔 **ID** • ${thread.id}`)
      .setTimestamp();
    logChannel.send({ embeds: [embed] });
  },
};
