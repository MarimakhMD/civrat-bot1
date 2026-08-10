"use strict";

const CACHE_TTL_MS = 5 * 60 * 1000;

const cache = new Map(); // guildId -> { config, expiresAt }

function getSupabase() {
  try {
    const mod = require("../config/database");
    return mod.supabase || mod.supabaseAdmin || null;
  } catch {
    return null;
  }
}

async function getGuildConfig(guildId) {
  if (!guildId || typeof guildId !== "string") return {};
  const cached = cache.get(guildId);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.config;
  }

  const supabase = getSupabase();
  if (!supabase) {
    // Offline / tests / missing database.js → return valid cached or empty, no throw
    if (cached && cached.expiresAt > now) return cached.config;
    // Expired or no cache → treat as unknown guild → empty
    return {};
  }

  try {
    const { data, error } = await supabase.from("guild_configs").select("*").eq("guild_id", guildId).maybeSingle();
    if (error) throw error;
    const config = data || {};
    cache.set(guildId, { config, expiresAt: now + CACHE_TTL_MS });
    return config;
  } catch {
    if (cached && cached.expiresAt > now) return cached.config;
    return {};
  }
}

async function updateGuildConfig(guildId, updates) {
  if (!guildId || typeof guildId !== "string") throw new Error("guildId required");
  if (!updates || typeof updates !== "object" || Array.isArray(updates) || Object.keys(updates).length === 0) {
    throw new Error("updates must be a non-empty object");
  }

  const supabase = getSupabase();
  if (!supabase) {
    // Offline: merge into cache and return
    const current = (await getGuildConfig(guildId)) || {};
    const merged = { ...current, ...updates };
    cache.set(guildId, { config: merged, expiresAt: Date.now() + CACHE_TTL_MS });
    return merged;
  }

  const { data, error } = await supabase
    .from("guild_configs")
    .upsert({ guild_id: guildId, ...updates }, { onConflict: "guild_id" })
    .select()
    .single();
  if (error) throw error;
  const config = data || { guild_id: guildId, ...updates };
  cache.set(guildId, { config, expiresAt: Date.now() + CACHE_TTL_MS });
  return config;
}

async function invalidateCache(guildId) {
  if (!guildId) {
    cache.clear();
    return;
  }
  cache.delete(guildId);
}

// Test helpers
function _clearCache() {
  cache.clear();
}

function _getCache() {
  return cache;
}

module.exports = { getGuildConfig, updateGuildConfig, invalidateCache, _clearCache, _getCache, CACHE_TTL_MS };
