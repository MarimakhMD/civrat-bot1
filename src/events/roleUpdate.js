const { AuditLogEvent } = require("discord.js");
const { getLogsRuntime } = require("../modules/logs/runtime/getLogsRuntime");
const { roleLabel } = require("../modules/logs/services/logLabels");
const { resolveAuditActor } = require("../utils/auditLogActor");
const guildConfigService = require("../services/guildConfig");
const logger = require("../utils/logger");

module.exports = {
  name: "roleUpdate",
  once: false,
  async execute(oldRole, newRole) {
    try {
      if (oldRole.name === newRole.name) return;
      const config = await guildConfigService.getGuildConfig(newRole.guild.id);
      const actor = await resolveAuditActor({ guild: newRole.guild, type: AuditLogEvent.RoleUpdate, targetId: newRole.id });
      await getLogsRuntime().handleRoleEvent({
        guild: newRole.guild,
        config,
        action: "role_updated",
        roleId: newRole.id,
        target: roleLabel(newRole),
        who: actor.executor,
        before: oldRole.name || null,
        after: newRole.name || null,
      });
    } catch (error) {
      // 4F-1 — observabilité : best-effort conservé.
      logger.warn("roleUpdate handling failed", { event: "role_update_failed", guildId: newRole?.guild?.id || null, error: error?.message || String(error) });
    }
  },
};
