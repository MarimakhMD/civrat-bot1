const logger = require("../utils/logger");

async function sendReminder(member, config) {
  if (!config.captcha_enabled || !config.captcha_channel_id || member.user.bot) return;
  const role = member.guild.roles.cache.get(config.captcha_role_id);
  if (role && member.roles.cache.has(role.id)) return;

  try {
    await member.user.send(`🛡 Bienvenue sur **${member.guild.name}**. Vérifiez votre compte dans <#${config.captcha_channel_id}>.`);
  } catch (error) {
    logger.warn(`Captcha reminder unavailable for ${member.user.tag}: ${error.message}`);
  }
}

module.exports = { sendReminder };
