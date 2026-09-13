const { AuditLogEvent } = require("discord.js");
const { getLogsRuntime } = require("../modules/logs/runtime/getLogsRuntime");
const { resolveAuditActor } = require("../utils/auditLogActor");
const logger = require("../utils/logger");

module.exports = {
  name: "channelCreate",
  once: false,
  async execute(channel) {
    try {
      if (!channel.guild) return;
      const actor = await resolveAuditActor({ guild: channel.guild, type: AuditLogEvent.ChannelCreate, targetId: channel.id });
      await getLogsRuntime().handleChannelEvent({
        channel,
        config: await require("../services/guildConfig").getGuildConfig(channel.guild.id),
        action: "channel_created",
        who: actor.executor,
      });
      try {
        await require("../modules/security/runtime/getSecurityRuntime").getSecurityRuntime().handleChannelCreate(channel);
      } catch (error) {
        // 4F-1 — observabilité : best-effort conservé.
        logger.warn("Security channelCreate handling failed", { event: "security_channel_create_failed", guildId: channel.guild?.id || null, error: error?.message || String(error) });
      }
    } catch (error) {
      // 4F-1 — observabilité : best-effort conservé.
      logger.warn("channelCreate handling failed", { event: "channel_create_failed", guildId: channel?.guild?.id || null, error: error?.message || String(error) });
    }
  },
};
