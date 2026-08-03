const { EmbedBuilder, PermissionsBitField } = require("discord.js");
const placeholder = require("./placeholder");
const logger = require("../utils/logger");

function contextFor(member) {
  return { user: member.user, member, guild: member.guild };
}

function canSend(channel, guild) {
  const me = guild.members.me;
  return Boolean(channel?.isTextBased?.() && me && channel.permissionsFor(me)?.has(PermissionsBitField.Flags.SendMessages));
}

async function sendWelcome(member, config) {
  if (!config.welcome_enabled) return { sent: false, reason: "disabled" };
  const channel = member.guild.channels.cache.get(config.welcome_channel_id);
  if (!canSend(channel, member.guild)) {
    await sendDeliveryLog(member.guild, config, "Welcome indisponible", `Le salon de bienvenue est introuvable ou inaccessible pour ${member.user}.`, "error");
    return { sent: false, reason: "channel_unavailable" };
  }
  const content = placeholder.parse(config.welcome_message || "", contextFor(member));
  if (!content.trim()) {
    await sendDeliveryLog(member.guild, config, "Welcome ignoré", `Le message de bienvenue est vide pour ${member.user}.`, "warning");
    return { sent: false, reason: "empty_message" };
  }
  try {
    if (config.welcome_embed_enabled) {
      await channel.send({ embeds: [new EmbedBuilder().setColor(config.welcome_embed_color || "#00e85c").setTitle("✨ Bienvenue !").setDescription(content).setThumbnail(member.user.displayAvatarURL()).setTimestamp()] });
    } else {
      await channel.send({ content });
    }
    await sendDeliveryLog(member.guild, config, "Welcome envoyé", `Message de bienvenue envoyé pour ${member.user}.`, "success");
    return { sent: true };
  } catch (error) {
    logger.error(`Welcome failed for ${member.user.tag}:`, error.message);
    await sendDeliveryLog(member.guild, config, "Échec Welcome", `Impossible d’envoyer le message de bienvenue pour ${member.user}.`, "error");
    return { sent: false, reason: "send_failed" };
  }
}

async function sendWelcomeDm(member, config) {
  if (!config.welcome_dm_enabled) return { sent: false, reason: "disabled" };
  const content = placeholder.parse(config.welcome_dm_message || config.welcome_message || "", contextFor(member));
  if (!content.trim()) return { sent: false, reason: "empty_message" };
  try {
    await member.user.send({ content });
    await sendDeliveryLog(member.guild, config, "MP Welcome envoyé", `Message privé envoyé à ${member.user}.`, "success");
    return { sent: true };
  } catch (error) {
    // Closed DMs are expected; the bot logs the outcome without surfacing an unhandled rejection.
    logger.warn(`Welcome DM unavailable for ${member.user.tag}: ${error.message}`);
    await sendDeliveryLog(member.guild, config, "Échec MP Welcome", `Impossible d’envoyer un message privé à ${member.user}.`, "warning");
    return { sent: false, reason: "dm_unavailable" };
  }
}

async function sendGoodbye(member, config) {
  if (!config.goodbye_enabled) return { sent: false, reason: "disabled" };
  const channel = member.guild.channels.cache.get(config.goodbye_channel_id);
  if (!canSend(channel, member.guild)) {
    await sendDeliveryLog(member.guild, config, "Goodbye indisponible", `Le salon de départ est introuvable ou inaccessible pour ${member.user}.`, "error", true);
    return { sent: false, reason: "channel_unavailable" };
  }
  const content = placeholder.parse(config.goodbye_message || "", contextFor(member));
  if (!content.trim()) return { sent: false, reason: "empty_message" };
  try {
    if (config.goodbye_embed_enabled) {
      await channel.send({ embeds: [new EmbedBuilder().setColor(config.goodbye_embed_color || "#ff4444").setDescription(content).setThumbnail(member.user.displayAvatarURL()).setTimestamp()] });
    } else {
      await channel.send({ content });
    }
    await sendDeliveryLog(member.guild, config, "Goodbye envoyé", `Message de départ envoyé pour ${member.user.tag}.`, "success", true);
    return { sent: true };
  } catch (error) {
    logger.error(`Goodbye failed for ${member.user.tag}:`, error.message);
    await sendDeliveryLog(member.guild, config, "Échec Goodbye", `Impossible d’envoyer le message de départ pour ${member.user.tag}.`, "error", true);
    return { sent: false, reason: "send_failed" };
  }
}

async function sendDeliveryLog(guild, config, title, description, tone, isLeave = false) {
  if (!config.logs_enabled) return;
  const channelId = isLeave ? config.log_member_leave_channel_id : config.log_member_join_channel_id;
  const channel = guild.channels.cache.get(channelId);
  if (!canSend(channel, guild)) return;
  const color = tone === "error" ? "#ed4245" : tone === "warning" ? "#fee75c" : "#57f287";
  await channel.send({ embeds: [new EmbedBuilder().setColor(color).setTitle(`📨 ${title}`).setDescription(description).setTimestamp()] }).catch((error) => logger.error("Welcome delivery log failed:", error.message));
}

function buildWelcomePreview(member, config) {
  const content = placeholder.parse(config.welcome_message || "", contextFor(member));
  if (config.welcome_embed_enabled) return { embeds: [new EmbedBuilder().setColor(config.welcome_embed_color || "#00e85c").setTitle("✨ Aperçu de bienvenue").setDescription(content || "Message vide").setThumbnail(member.user.displayAvatarURL()).setTimestamp()] };
  return { content: content || "Message de bienvenue vide" };
}

module.exports = { sendWelcome, sendWelcomeDm, sendGoodbye, buildWelcomePreview };
