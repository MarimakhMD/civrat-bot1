const { getLogsRuntime } = require("../modules/logs/runtime/getLogsRuntime");
const guildConfigService = require("../services/guildConfig");
const logger = require("../utils/logger");

module.exports = {
  name: "roleUpdate",
  once: false,
  async execute(oldRole, newRole) {
    try {
      if (oldRole.name === newRole.name) return;
      const config = await guildConfigService.getGuildConfig(newRole.guild.id);
      await getLogsRuntime().handleRoleEvent({
        guild: newRole.guild,
        config,
        action: "role_updated",
        roleId: newRole.id,
      });
    } catch (error) {
      // 4F-1 — observabilité : best-effort conservé.
      logger.warn("roleUpdate handling failed", { event: "role_update_failed", guildId: newRole?.guild?.id || null, error: error?.message || String(error) });
    }
  },
};
