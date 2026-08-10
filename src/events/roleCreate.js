const { getLogsRuntime } = require("../modules/logs/runtime/getLogsRuntime");
const guildConfigService = require("../services/guildConfig");
const securityService = require("../services/securityService");

module.exports = {
  name: "roleCreate",
  once: false,
  async execute(role) {
    try {
      const config = await guildConfigService.getGuildConfig(role.guild.id);
      if (config.logs_enabled) {
        await securityService.recordNukeAction(role.guild, config, 30, "roles");
      }
      await getLogsRuntime().handleRoleEvent({
        guild: role.guild,
        config,
        action: "role_created",
        roleId: role.id,
      });
    } catch {}
  },
};
