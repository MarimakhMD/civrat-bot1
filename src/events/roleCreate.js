const { AuditLogEvent } = require("discord.js");
const { getLogsRuntime } = require("../modules/logs/runtime/getLogsRuntime");
const { roleLabel } = require("../modules/logs/services/logLabels");
const { resolveAuditActor } = require("../utils/auditLogActor");
const logger = require("../utils/logger");

module.exports = {
  name: "roleCreate",
  once: false,
  async execute(role) {
    try {
      const actor = await resolveAuditActor({ guild: role.guild, type: AuditLogEvent.RoleCreate, targetId: role.id });
      await getLogsRuntime().handleRoleEvent({
        guild: role.guild,
        config: await require("../services/guildConfig").getGuildConfig(role.guild.id),
        action: "role_created",
        roleId: role.id,
        target: roleLabel(role),
        who: actor.executor,
      });
      try {
        await require("../modules/security/runtime/getSecurityRuntime").getSecurityRuntime().handleRoleCreate(role);
      } catch (error) {
        // 4F-1 — observabilité : best-effort conservé.
        logger.warn("Security roleCreate handling failed", { event: "security_role_create_failed", guildId: role?.guild?.id || null, error: error?.message || String(error) });
      }
    } catch (error) {
      // 4F-1 — observabilité : best-effort conservé.
      logger.warn("roleCreate handling failed", { event: "role_create_failed", guildId: role?.guild?.id || null, error: error?.message || String(error) });
    }
  },
};
