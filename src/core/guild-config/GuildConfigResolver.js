"use strict";

const { ConfigurationError, ValidationError } = require("../errors");
const { resolveGuildLocale } = require("../i18n");

/** Stable module-facing facade for guild configuration reads and invalidation. */
class GuildConfigResolver {
  constructor({ repository, logger = null }) {
    if (!repository || typeof repository.getByGuildId !== "function") {
      throw new TypeError("GuildConfigResolver requires a GuildConfigRepository-compatible dependency.");
    }
    this.repository = repository;
    this.logger = logger;
  }

  async get(guildId) {
    assertGuildId(guildId);
    try {
      const config = await this.repository.getByGuildId(guildId);
      if (!config || typeof config !== "object") {
        throw new ConfigurationError("CONFIGURATION_UNAVAILABLE", { guildId, reason: "empty_config" });
      }
      return config;
    } catch (error) {
      if (error instanceof ConfigurationError) throw error;
      this.logger?.error?.("Guild configuration resolution failed", { guildId, reason: error?.code || "unknown", error: error?.message || String(error) });
      throw new ConfigurationError("CONFIGURATION_UNAVAILABLE", { guildId, reason: error?.code || "unknown" }, error);
    }
  }

  async getLanguage(guildId) {
    const config = await this.get(guildId);
    return resolveGuildLocale(config.language);
  }

  /** Stable module-facing write path. It invalidates the targeted guild after a successful update. */
  async update(guildId, updates) {
    assertGuildId(guildId);
    assertUpdates(updates);
    if (typeof this.repository.updateByGuildId !== "function") {
      throw new ConfigurationError("CONFIGURATION_UNAVAILABLE", { guildId, reason: "repository_write_unsupported" });
    }
    try {
      const config = await this.repository.updateByGuildId(guildId, updates);
      if (!config || typeof config !== "object") {
        throw new ConfigurationError("CONFIGURATION_UNAVAILABLE", { guildId, reason: "empty_updated_config" });
      }
      await this.invalidate(guildId);
      this.logger?.info?.("Guild configuration updated", { guildId, keys: Object.keys(updates) });
      return config;
    } catch (error) {
      if (error instanceof ConfigurationError) throw error;
      this.logger?.error?.("Guild configuration update failed", { guildId, keys: Object.keys(updates), reason: error?.code || "unknown", error: error?.message || String(error) });
      throw new ConfigurationError("CONFIGURATION_UNAVAILABLE", { guildId, reason: error?.code || "unknown" }, error);
    }
  }

  async invalidate(guildId) {
    assertGuildId(guildId);
    await this.repository.invalidate?.(guildId);
    this.logger?.debug?.("Guild configuration invalidated", { guildId });
  }
}

function assertGuildId(guildId) {
  if (typeof guildId !== "string" || !guildId.trim()) {
    throw new ValidationError({ field: "guildId", reason: "required_string" });
  }
}

function assertUpdates(updates) {
  if (!updates || typeof updates !== "object" || Array.isArray(updates) || Object.keys(updates).length === 0) {
    throw new ValidationError({ field: "updates", reason: "non_empty_object_required" });
  }
}

module.exports = { GuildConfigResolver, assertGuildId, assertUpdates };
