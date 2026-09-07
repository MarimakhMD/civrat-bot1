const { getLogsRuntime } = require("../modules/logs/runtime/getLogsRuntime");
const logger = require("../utils/logger");
module.exports = {
  name: "channelDelete",
  once: false,
  async execute(channel) {
    try {
      if (!channel.guild) return;
      await getLogsRuntime().handleChannelEvent({ channel, config: await require("../services/guildConfig").getGuildConfig(channel.guild.id), action: "channel_deleted" });
      try {
        await require("../modules/security/runtime/getSecurityRuntime").getSecurityRuntime().handleChannelDelete(channel);
      } catch (error) {
        // 4F-1 — observabilité : best-effort conservé.
        logger.warn("Security channelDelete handling failed", { event: "security_channel_delete_failed", guildId: channel.guild?.id || null, error: error?.message || String(error) });
      }
    } catch (error) {
      // 4F-1 — observabilité : best-effort conservé.
      logger.warn("channelDelete handling failed", { event: "channel_delete_failed", guildId: channel?.guild?.id || null, error: error?.message || String(error) });
    }
  },
};
