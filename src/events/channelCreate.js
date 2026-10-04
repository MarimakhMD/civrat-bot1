const { AuditLogEvent } = require("discord.js");
const { getLogsRuntime } = require("../modules/logs/runtime/getLogsRuntime");
const { resolveAuditActor } = require("../utils/auditLogActor");
const guildConfigService = require("../services/guildConfig");
const logger = require("../utils/logger");

module.exports = {
  name: "channelCreate",
  once: false,
  async execute(channel) {
    try {
      if (!channel.guild) return;
      // PHASE 1 — la config est lue AVANT l'Audit Log : si les logs sont
      // coupés, aucune requête API n'est émise pour un log qui sera jeté.
      const config = await guildConfigService.getGuildConfig(channel.guild.id);

      // P2-A — résolution Audit Log UNE SEULE FOIS, partagée entre Logs et
      // Security. Résolue si les Logs sont actifs OU si l'anti-nuke est actif
      // (même Logs coupés). Jamais de second resolve côté Security : l'entrée
      // serait déjà consommée et la recherche échouerait.
      const actor = (config?.logs_enabled || config?.security_anti_nuke)
        ? await resolveAuditActor({ guild: channel.guild, type: AuditLogEvent.ChannelCreate, targetId: channel.id })
        : null;

      if (config?.logs_enabled) {
        await getLogsRuntime().handleChannelEvent({
          channel,
          config,
          action: "channel_created",
          who: actor ? actor.executor : undefined,
        });
      }

      try {
        await require("../modules/security/runtime/getSecurityRuntime").getSecurityRuntime().handleChannelCreate(channel, actor);
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
