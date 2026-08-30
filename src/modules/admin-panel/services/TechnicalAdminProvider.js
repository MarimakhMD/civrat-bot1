"use strict";

const { CivratAdminProvider } = require("../../../core/permissions");

const DISCORD_ID_PATTERN = /^\d{15,21}$/;

function isDiscordId(value) {
  return typeof value === "string" && DISCORD_ID_PATTERN.test(value);
}

/**
 * Effective CIVRAT Admin authority.
 *
 * Access is granted only when every deployment-level condition is true. The
 * provider consumes normalized capabilities and never imports discord.js.
 */
class TechnicalAdminProvider extends CivratAdminProvider {
  constructor({ guildId, channelId, roleId, logger = null }) {
    super();
    this.guildId = guildId || null;
    this.channelId = channelId || null;
    this.roleId = roleId || null;
    this.logger = logger;
  }

  isConfigured() {
    return [this.guildId, this.channelId, this.roleId].every(isDiscordId);
  }

  async isAdmin(context) {
    try {
      if (!this.isConfigured()) return false;
      if (context?.guildId !== this.guildId) return false;
      if (context?.channelId !== this.channelId) return false;
      return Boolean(context?.member?.hasRole?.(this.roleId));
    } catch (_error) {
      this.logger?.warn?.("admin_access_check_failed");
      return false;
    }
  }
}

module.exports = { TechnicalAdminProvider, isDiscordId };
