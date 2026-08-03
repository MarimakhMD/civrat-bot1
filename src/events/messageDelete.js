const guildConfigService = require("../services/guildConfig");
const { fetchAuditLog } = require("../utils/auditLogCache");
const { sendLog } = require("../services/logService");

module.exports = { name: "messageDelete", once: false, async execute(message) {
  try {
    if (!message.guild || !message.author || message.author.bot) return;
    const config = await guildConfigService.getGuildConfig(message.guild.id);
    if (!config.logs_enabled) return;
    const entry = await fetchAuditLog(message.guild, 72);
    const moderator = entry && Date.now() - entry.createdTimestamp < 5000 && entry.target?.id === message.author.id ? entry.executor : null;
    await sendLog(message.guild, config, "log_message_delete_channel_id", { title: "🗑 Message supprimé", color: "danger", target: `${message.author} (${message.author.id})`, moderator, fields: [{ name: "Salon", value: `${message.channel || "Inconnu"}`, inline: true }, { name: "Contenu", value: `\`\`\`\n${(message.content || "Aucun contenu / pièce jointe").slice(0, 900)}\n\`\`\`` }] });
  } catch { /* a deleted/partial message must never break the listener */ }
} };
