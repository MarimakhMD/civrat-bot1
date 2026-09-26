const { AuditLogEvent } = require("discord.js");
const { getLogsRuntime } = require("../modules/logs/runtime/getLogsRuntime");
const { roleLabel } = require("../modules/logs/services/logLabels");
const { resolveAuditActor } = require("../utils/auditLogActor");
const guildConfigService = require("../services/guildConfig");
const logger = require("../utils/logger");

module.exports = {
  name: "roleDelete",
  once: false,
  async execute(role) {
    try {
      // PHASE 1 — la config est lue AVANT l'Audit Log : si les logs sont
      // coupés, aucune requête API n'est émise pour un log qui sera jeté.
      const config = await guildConfigService.getGuildConfig(role.guild.id);

      // P2-A — résolution Audit Log UNE SEULE FOIS, partagée entre Logs et
      // Security (voir channelCreate).
      const actor = (config?.logs_enabled || config?.security_anti_nuke)
        ? await resolveAuditActor({ guild: role.guild, type: AuditLogEvent.RoleDelete, targetId: role.id })
        : null;

      if (config?.logs_enabled) {
        await getLogsRuntime().handleRoleEvent({
          guild: role.guild,
          config,
          action: "role_deleted",
          roleId: role.id,
          target: roleLabel(role),
          who: actor ? actor.executor : undefined,
        });
      }

      try {
        await require("../modules/security/runtime/getSecurityRuntime").getSecurityRuntime().handleRoleDelete(role, actor);
      } catch (error) {
        // 4F-1 — observabilité : best-effort conservé.
        logger.warn("Security roleDelete handling failed", { event: "security_role_delete_failed", guildId: role?.guild?.id || null, error: error?.message || String(error) });
      }
    } catch (error) {
      // 4F-1 — observabilité : best-effort conservé.
      logger.warn("roleDelete handling failed", { event: "role_delete_failed", guildId: role?.guild?.id || null, error: error?.message || String(error) });
    }
  },
};
