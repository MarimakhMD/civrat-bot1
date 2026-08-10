const { getLogsRuntime } = require("../modules/logs/runtime/getLogsRuntime");

module.exports = {
  name: "roleCreate",
  once: false,
  async execute(role) {
    try {
      await getLogsRuntime().handleRoleEvent({
        guild: role.guild,
        config: await require("../services/guildConfig").getGuildConfig(role.guild.id),
        action: "role_created",
        roleId: role.id,
      });
      try {
        await require("../modules/security/runtime/getSecurityRuntime").getSecurityRuntime().handleRoleCreate(role);
      } catch {}
    } catch {}
  },
};
