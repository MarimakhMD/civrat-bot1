"use strict";

const logger = require("../utils/logger");

const CACHE_TTL_MS = 5 * 60 * 1000;

const cache = new Map(); // guildId -> { config, expiresAt }

// Ne journalise JAMAIS de secret : masque toute éventuelle URL d'identification
// (motif scheme://user:password@) par précaution, bien que Supabase ne renvoie
// pas de credentials dans ses messages d'erreur.
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
  } catch (error) {
    // Lecture tolérante : en cas d'erreur, on sert le cache ou {} (jamais de
    // crash), mais on logue la vraie cause (table absente, connexion refusée…)
    // pour que l'hébergement révèle pourquoi la config est indisponible.
    logger.warn("guild_configs read failed (falling back to cache/empty)", {
      guildId,
      code: error?.code || error?.name || null,
      error: sanitizeError(error),
    });
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
  if (error) {
    // Écriture échouée : logue la vraie cause (code PostgREST/Postgres,
    // ex. "42P01" table inexistante) puis propage une erreur typée pour que
    // le resolver puisse la distinguer (SUPABASE_WRITE_FAILED vs autre).
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
