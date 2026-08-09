const { EmbedBuilder, PermissionsBitField } = require("discord.js");
const logger = require("../utils/logger");

const COLORS = { success: "#57f287", info: "#5865f2", warning: "#fee75c", danger: "#ed4245" };

function canSend(channel, guild) {
  return Boolean(channel?.isTextBased?.() && guild.members.me && channel.permissionsFor(guild.members.me)?.has(PermissionsBitField.Flags.SendMessages));
}

/** Send a CIVRAT embed to the configured canonical log channel. Never throws to an event handler. */
async function sendLog(guild, config, channelKey, { title, color = "info", description, target, moderator, fields = [] }) {
  const channelId = config[channelKey];
  if (!channelId) return false;
  const channel = guild.channels.cache.get(channelId);
  if (!canSend(channel, guild)) {
    logger.warn(`Log channel unavailable for ${guild.id}:${channelKey}`);
    return false;
  }
  const lines = [];
  if (target) lines.push(`👤 **Membre** • ${target}`);
  if (moderator) lines.push(`🛡 **Modérateur** • ${moderator}`);
  if (description) lines.push(description);
  const embed = new EmbedBuilder().setColor(COLORS[color] || COLORS.info).setTitle(title).setDescription(lines.join("\n").slice(0, 4096)).setTimestamp();
  if (fields.length) embed.addFields(fields.slice(0, 25).map((field) => ({ name: String(field.name).slice(0, 256), value: String(field.value || "—").slice(0, 1024), inline: Boolean(field.inline) })));
  try {
    await channel.send({ embeds: [embed] });
    return true;
  } catch (error) {
    logger.error(`Log send failed for ${guild.id}:${channelKey}:`, error.message);
    return false;
  }
}

module.exports = { sendLog, COLORS };
