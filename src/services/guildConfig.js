"use strict";

const logger = require("../utils/logger");

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map(); // guildId -> { config, expiresAt, found, source }

function sanitizeError(error) {
  const message = String(error?.message || error || "unknown");
  return message.replace(/([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^/@\s]+@/g, "$1***@");
}

function getSupabase() {
  try {
    const mod = require("../config/database");
    return mod.supabase || mod.supabaseAdmin || null;
  } catch {
    return null;
  }
}

function hasPersistedValues(config) {
  return Boolean(config && typeof config === "object" && Object.keys(config).length > 0);
}

function state({ config = {}, available, found, source }) {
  return {
    config,
    available: Boolean(available),
    found: Boolean(found),
    source,
  };
}

/**
 * Reads both the effective configuration and its observable persistence state.
 * No backend error details are exposed to callers; detailed sanitized logging
 * remains server-side. `getGuildConfig` below preserves the legacy API.
 */
async function getGuildConfigState(guildId) {
  if (!guildId || typeof guildId !== "string") {
    return state({ config: {}, available: false, found: false, source: "invalid" });
  }

  const cached = cache.get(guildId);
  const now = Date.now();
  const supabase = getSupabase();

  if (cached && cached.expiresAt > now) {
    return state({
      config: cached.config,
      available: Boolean(supabase),
      found: cached.found ?? hasPersistedValues(cached.config),
      source: cached.source === "memory" ? "memory" : "cache",
    });
  }

  if (!supabase) {
    return state({ config: {}, available: false, found: false, source: "unavailable" });
  }

  try {
    const { data, error } = await supabase
      .from("guild_configs")
      .select("*")
      .eq("guild_id", guildId)
      .maybeSingle();
    if (error) throw error;

    const config = data || {};
    const found = Boolean(data);
    cache.set(guildId, {
      config,
      expiresAt: now + CACHE_TTL_MS,
      found,
      source: "database",
    });
    return state({
      config,
      available: true,
      found,
      source: found ? "database" : "defaults",
    });
  } catch (error) {
    logger.warn("guild_configs read failed (falling back to cache/empty)", {
      guildId,
      code: error?.code || error?.name || null,
      error: sanitizeError(error),
    });
    return state({ config: {}, available: false, found: false, source: "unavailable" });
  }
}

async function getGuildConfig(guildId) {
  return (await getGuildConfigState(guildId)).config;
}

async function updateGuildConfig(guildId, updates) {
  if (!guildId || typeof guildId !== "string") throw new Error("guildId required");
  if (!updates || typeof updates !== "object" || Array.isArray(updates) || Object.keys(updates).length === 0) {
    throw new Error("updates must be a non-empty object");
  }

  const supabase = getSupabase();
  if (!supabase) {
    const current = (await getGuildConfig(guildId)) || {};
    const merged = { ...current, ...updates };
    cache.set(guildId, {
      config: merged,
      expiresAt: Date.now() + CACHE_TTL_MS,
      found: true,
      source: "memory",
    });
    return merged;
  }

  const { data, error } = await supabase
    .from("guild_configs")
    .upsert({ guild_id: guildId, ...updates }, { onConflict: "guild_id" })
    .select()
    .single();
  if (error) {
    logger.warn("guild_configs write failed", {
      guildId,
      code: error?.code || error?.name || "SUPABASE_WRITE_FAILED",
      error: sanitizeError(error),
    });
    const wrapped = new Error(`guild_configs write failed: ${sanitizeError(error)}`);
    wrapped.code = error?.code || "SUPABASE_WRITE_FAILED";
    throw wrapped;
  }

  const config = data || { guild_id: guildId, ...updates };
  cache.set(guildId, {
    config,
    expiresAt: Date.now() + CACHE_TTL_MS,
    found: true,
    source: "database",
  });
  return config;
}

async function invalidateCache(guildId) {
  if (!guildId) {
    cache.clear();
    return;
  }
  cache.delete(guildId);
}

function _clearCache() {
  cache.clear();
}

function _getCache() {
  return cache;
}

module.exports = {
  getGuildConfig,
  getGuildConfigState,
  updateGuildConfig,
  invalidateCache,
  _clearCache,
  _getCache,
  CACHE_TTL_MS,
};
