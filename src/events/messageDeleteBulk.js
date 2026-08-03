const guildConfigService = require("../services/guildConfig");
const { sendLog } = require("../services/logService");
module.exports = { name: "messageDeleteBulk", once: false, async execute(messages) {
  try {
    const first = messages.first(); if (!first?.guild) return;
    const config = await guildConfigService.getGuildConfig(first.guild.id); if (!config.logs_enabled) return;
    await sendLog(first.guild, config, "log_message_delete_channel_id", { title: "🧹 Suppression massive", color: "warning", fields: [{ name: "Salon", value: `${first.channel}`, inline: true }, { name: "Messages supprimés", value: String(messages.size), inline: true }] });
  } catch {}
} };
