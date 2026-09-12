const { AuditLogEvent } = require("discord.js");
const guildConfigService = require("../services/guildConfig");
const { getLogsRuntime } = require("../modules/logs/runtime/getLogsRuntime");
const { channelLabel } = require("../modules/logs/services/logLabels");
const { resolveAuditActor } = require("../utils/auditLogActor");
const logger = require("../utils/logger");

module.exports = {
  name: "threadDelete",
  once: false,
  async execute(thread) {
    try {
      if (!thread.guild) return;
      const config = await guildConfigService.getGuildConfig(thread.guild.id);
      // P1b — auteur de la suppression résolu via Audit Log (cible = le thread).
      const actor = await resolveAuditActor({ guild: thread.guild, type: AuditLogEvent.ThreadDelete, targetId: thread.id });
      await getLogsRuntime().handleChannelEvent({
        channel: thread,
        config,
        action: "thread_deleted",
        who: actor.executor,
        parent: thread.parent ? channelLabel(thread.parent) : null,
      });
    } catch (error) {
      // 4F-1 — observabilité : best-effort conservé.
      logger.warn("threadDelete handling failed", { event: "thread_delete_failed", guildId: thread?.guild?.id || null, error: error?.message || String(error) });
    }
  },
};
