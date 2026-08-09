const guildConfigService = require("../services/guildConfig");
const { sendLog } = require("../services/logService");
module.exports = { name: "messageUpdate", once: false, async execute(oldMessage, newMessage) {
  try {
    if (!newMessage.guild || newMessage.author?.bot || oldMessage.content === newMessage.content) return;
    const config = await guildConfigService.getGuildConfig(newMessage.guild.id);
    if (!config.logs_enabled) return;
    await sendLog(newMessage.guild, config, "log_message_edit_channel_id", { title: "✏️ Message modifié", color: "info", target: `${newMessage.author} (${newMessage.author.id})`, fields: [{ name: "Salon", value: `${newMessage.channel}`, inline: true }, { name: "Lien", value: newMessage.url ? `[Ouvrir le message](${newMessage.url})` : "Indisponible", inline: true }, { name: "Avant", value: `\`\`\`\n${(oldMessage.content || "—").slice(0, 450)}\n\`\`\`` }, { name: "Après", value: `\`\`\`\n${(newMessage.content || "—").slice(0, 450)}\n\`\`\`` }] });
  } catch {}
} };
