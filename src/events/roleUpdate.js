const { getLogsRuntime } = require("../modules/logs/runtime/getLogsRuntime");
const guildConfigService = require("../services/guildConfig");

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
    } catch {}
  },
};
