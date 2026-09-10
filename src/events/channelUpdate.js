const guildConfigService = require("../services/guildConfig");
const { getLogsRuntime } = require("../modules/logs/runtime/getLogsRuntime");
const logger = require("../utils/logger");
module.exports = {
  name: "channelUpdate",
  once: false,
  async execute(oldChannel, newChannel) {
    try {
      if (!newChannel.guild || oldChannel.name === newChannel.name) return;
      const config = await guildConfigService.getGuildConfig(newChannel.guild.id);
      await getLogsRuntime().handleChannelEvent({ channel: newChannel, config, action: "channel_updated" });
    } catch (error) {
      // 4F-1 — observabilité : best-effort conservé.
      logger.warn("channelUpdate handling failed", { event: "channel_update_failed", guildId: newChannel?.guild?.id || null, error: error?.message || String(error) });
    }
  },
};
