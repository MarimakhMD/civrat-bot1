// ═══════════════════════════════════════════════════
// EVENT: ready - Bot startup initialization
// ═══════════════════════════════════════════════════
// FIX: Original used "clientReady" which doesn't exist.
// The correct event name is "ready".

const inviteService = require("../services/inviteService");
const guildConfig = require("../services/guildConfig");
const logger = require("../utils/logger");
const tempVoiceService = require("../services/tempVoiceService");

module.exports = {
  name: "ready",
  once: true,

  async execute(client) {
    logger.success(`${client.user.tag} connecté !`);

    // Set bot status
    client.user.setPresence({
      activities: [
        { name: `${client.guilds.cache.size} serveur(s)`, type: 3 },
      ],
      status: "online",
    });

    // Preload guild configs from Supabase
    await guildConfig.preloadConfigs(client);

    // Remove persisted temporary voice records whose channels are now empty.
    await tempVoiceService.cleanupGuild(client);

    // Cache invites for all guilds
    for (const guild of client.guilds.cache.values()) {
      try {
        const invites = await guild.invites.fetch();
        inviteService.cacheGuildInvites(guild.id, invites);
        logger.info(`Cached ${invites.size} invites for ${guild.name}`);
      } catch (err) {
        logger.warn(`Could not cache invites for ${guild.name}: ${err.message}`);
      }
    }
  },
};
