const guildConfigService = require("../services/guildConfig");
const { sendLog } = require("../services/logService");
const securityService = require("../services/securityService");
module.exports = { name: "roleCreate", once: false, async execute(role) { try { const config = await guildConfigService.getGuildConfig(role.guild.id); if (config.logs_enabled) await securityService.recordNukeAction(role.guild, config, 30, "créations de rôles");
    await sendLog(role.guild, config, "log_role_update_channel_id", { title: "🎭 Rôle créé", color: "success", fields: [{ name: "Rôle", value: `${role}`, inline: true }, { name: "ID", value: role.id, inline: true }] }); } catch {} } };
