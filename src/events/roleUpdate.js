const { AuditLogEvent } = require("discord.js");
const { getLogsRuntime } = require("../modules/logs/runtime/getLogsRuntime");
const { roleLabel } = require("../modules/logs/services/logLabels");
const { roleChanges, formatChanges } = require("../modules/logs/services/logDiffs");
const { resolveAuditActor } = require("../utils/auditLogActor");
const guildConfigService = require("../services/guildConfig");
const logger = require("../utils/logger");

module.exports = {
  name: "roleUpdate",
  once: false,
  async execute(oldRole, newRole) {
    try {
      // PHASE 1 — tous les changements réels, pas seulement le renommage.
      // La config est lue AVANT l'Audit Log : si les logs sont coupés, aucune
      // requête API n'est émise.
      const config = await guildConfigService.getGuildConfig(newRole.guild.id);
      if (!config?.logs_enabled) return;

      const changes = roleChanges(oldRole, newRole);
      if (changes.length === 0) return;

      const { before, after, permissions } = formatChanges(changes, config);
      const actor = await resolveAuditActor({
        guild: newRole.guild,
        type: AuditLogEvent.RoleUpdate,
        targetId: newRole.id,
      });

      await getLogsRuntime().handleRoleEvent({
        guild: newRole.guild,
        config,
        action: "role_updated",
        roleId: newRole.id,
        target: roleLabel(newRole),
        who: actor.executor,
        before,
        after,
        permissions,
      });
    } catch (error) {
      // 4F-1 — observabilité : best-effort conservé.
      logger.warn("roleUpdate handling failed", { event: "role_update_failed", guildId: newRole?.guild?.id || null, error: error?.message || String(error) });
    }
  },
};
