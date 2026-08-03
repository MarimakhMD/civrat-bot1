const guildConfigService = require("../services/guildConfig");
const { sendLog } = require("../services/logService");
const securityService = require("../services/securityService");
module.exports = { name: "roleDelete", once: false, async execute(role) { try { const config = await guildConfigService.getGuildConfig(role.guild.id); if (config.logs_enabled) await securityService.recordNukeAction(role.guild, config, 32, "suppressions de rôles");
    await sendLog(role.guild, config, "log_role_update_channel_id", { title: "🗑 Rôle supprimé", color: "danger", fields: [{ name: "Nom", value: role.name || "—", inline: true }, { name: "ID", value: role.id, inline: true }] }); } catch {} } };
