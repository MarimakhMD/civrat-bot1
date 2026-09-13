const { AuditLogEvent } = require("discord.js");
const { getLogsRuntime } = require("../modules/logs/runtime/getLogsRuntime");
const { resolveAuditActor } = require("../utils/auditLogActor");
const guildConfigService = require("../services/guildConfig");
const logger = require("../utils/logger");

module.exports = {
  name: "channelDelete",
  once: false,
  async execute(channel) {
    try {
      if (!channel.guild) return;
      // PHASE 1 — la config est lue AVANT l'Audit Log : si les logs sont
      // coupés, aucune requête API n'est émise pour un log qui sera jeté.
      const config = await guildConfigService.getGuildConfig(channel.guild.id);

      if (config?.logs_enabled) {
        const actor = await resolveAuditActor({ guild: channel.guild, type: AuditLogEvent.ChannelDelete, targetId: channel.id });
        await getLogsRuntime().handleChannelEvent({
          channel,
          config,
          action: "channel_deleted",
          who: actor.executor,
        });
      }

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
