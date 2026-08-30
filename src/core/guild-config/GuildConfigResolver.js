"use strict";

const {
  CivratError,
  ErrorCode,
  ConfigurationError,
  ValidationError,
} = require("../errors");
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

  async getState(guildId) {
    assertGuildId(guildId);

    try {
      if (typeof this.repository.getStateByGuildId === "function") {
        return this.normalizeState(await this.repository.getStateByGuildId(guildId));
      }

      const config = await this.repository.getByGuildId(guildId);
      if (!config || typeof config !== "object" || Array.isArray(config)) {
        throw new ConfigurationError(ErrorCode.CONFIGURATION_UNAVAILABLE, {
          operation: "read",
          resource: "guild_config",
          reason: "empty_config",
        });
      }
      return {
        config,
        available: true,
        found: Object.keys(config).length > 0,
        source: "repository",
        reason: null,
      };
    } catch (error) {
      if (error instanceof CivratError) throw error;
      this.logger?.error?.("Guild configuration resolution failed", {
        guildId,
        operation: "read",
        errorType: error?.name || typeof error,
        errorCode: safeCode(error?.code),
      });
      throw new ConfigurationError(
        "Unable to read guild configuration",
        { operation: "read", resource: "guild_config" },
        error
      );
    }
  }

  async get(guildId) {
    const state = await this.getState(guildId);
    return state.config;
  }

  async getLanguage(guildId) {
    const config = await this.get(guildId);
    return resolveGuildLocale(config.language);
  }

  async update(guildId, updates) {
    assertGuildId(guildId);
    assertUpdates(updates);
    if (typeof this.repository.updateByGuildId !== "function") {
      throw new ConfigurationError(ErrorCode.CONFIGURATION_UNAVAILABLE, {
        operation: "write",
        resource: "guild_config",
        reason: "repository_write_unsupported",
      });
    }

    try {
      const updated = await this.repository.updateByGuildId(guildId, updates);
      if (!updated || typeof updated !== "object" || Array.isArray(updated)) {
        throw new ConfigurationError(ErrorCode.CONFIGURATION_UNAVAILABLE, {
          operation: "write",
          resource: "guild_config",
          reason: "empty_updated_config",
        });
      }
      await this.invalidate(guildId);
      this.logger?.info?.("Guild configuration updated", {
        guildId,
        operation: "write",
        keyCount: Object.keys(updates).length,
      });
      return updated;
    } catch (error) {
      if (error instanceof CivratError) throw error;
      this.logger?.error?.("Guild configuration update failed", {
        guildId,
        operation: "write",
        keyCount: Object.keys(updates).length,
        errorType: error?.name || typeof error,
        errorCode: safeCode(error?.code),
      });
      throw new ConfigurationError(
        "Unable to update guild configuration",
        { operation: "write", resource: "guild_config" },
        error
      );
    }
  }

  async invalidate(guildId) {
    assertGuildId(guildId);
    await this.repository.invalidate?.(guildId);
    this.logger?.debug?.("Guild configuration invalidated", { guildId });
  }

  normalizeState(state) {
    if (!state || typeof state !== "object" || Array.isArray(state)) {
      throw new ConfigurationError(ErrorCode.CONFIGURATION_UNAVAILABLE, {
        operation: "read",
        resource: "guild_config",
        reason: "INVALID_STATE",
      });
    }

    return {
      config: normalizeConfig(state.config),
      available: Boolean(state.available),
      found: Boolean(state.found),
      source: typeof state.source === "string" ? state.source : "repository",
      reason: typeof state.reason === "string" ? state.reason : null,
    };
  }
}


function normalizeConfig(config) {
  return config && typeof config === "object" && !Array.isArray(config) ? config : {};
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

function safeCode(value) {
  return typeof value === "string" || typeof value === "number" ? value : null;
}

module.exports = { GuildConfigResolver, assertGuildId, assertUpdates };
