const { AuditLogEvent } = require("discord.js");
const guildConfigService = require("../services/guildConfig");
const { getLogsRuntime } = require("../modules/logs/runtime/getLogsRuntime");
const { channelChanges, formatChanges } = require("../modules/logs/services/logDiffs");
const { resolveAuditActor } = require("../utils/auditLogActor");
const logger = require("../utils/logger");

module.exports = {
  name: "channelUpdate",
  once: false,
  async execute(oldChannel, newChannel) {
    try {
      if (!newChannel.guild) return;

      // PHASE 1 — nom, description, permissions, position, slowmode, NSFW,
      // catégorie… : tous les changements réellement détectés, et uniquement
      // ceux-là. La config est lue AVANT l'Audit Log : si les logs sont coupés,
      // aucune requête API n'est émise.
      const config = await guildConfigService.getGuildConfig(newChannel.guild.id);
      if (!config?.logs_enabled) return;

      const changes = channelChanges(oldChannel, newChannel);
      if (changes.length === 0) return;

      const { before, after, permissions } = formatChanges(changes, config);
      const actor = await resolveAuditActor({
        guild: newChannel.guild,
        type: AuditLogEvent.ChannelUpdate,
        targetId: newChannel.id,
      });

      await getLogsRuntime().handleChannelEvent({
        channel: newChannel,
        config,
        action: "channel_updated",
        who: actor.executor,
        before,
        after,
        permissions,
      });
    } catch (error) {
      // 4F-1 — observabilité : best-effort conservé.
      logger.warn("channelUpdate handling failed", { event: "channel_update_failed", guildId: newChannel?.guild?.id || null, error: error?.message || String(error) });
    }
  },
};
