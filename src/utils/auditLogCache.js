"use strict";

const CACHE_TTL_MS = 3000;
const cache = new Map(); // guildId:type -> { entry, expiresAt }

/**
 * Fetches the latest audit log entry for a guild and type, with a 3s cache to avoid rate limits.
 * Returns the first entry or null.
 */
async function fetchAuditLog(guild, type) {
  if (!guild || !guild.id) return null;
  const key = `${guild.id}:${type}`;
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.entry;
  }
  try {
    const logs = await guild.fetchAuditLogs({ type, limit: 1 });
    const entry = logs.entries.first() || null;
    cache.set(key, { entry, expiresAt: now + CACHE_TTL_MS });
    return entry;
  } catch {
    return null;
  }
}

function _clearCache() {
  cache.clear();
}

function _getCache() {
  return cache;
}

module.exports = { fetchAuditLog, _clearCache, _getCache, CACHE_TTL_MS };
