// ═══════════════════════════════════════════════════
// AUDIT LOG CACHE - Prevents Discord API rate limits
// ═══════════════════════════════════════════════════
// Multiple events fire simultaneously (kick, role changes, etc.)
// and each calls fetchAuditLogs independently. This cache
// deduplicates requests within a short TTL window.

const logger = require("./logger");

const cache = new Map();
const CACHE_TTL = 3000; // 3 seconds

/**
 * Fetch audit logs with caching to prevent rate limits.
 * @param {Guild} guild - The Discord guild
 * @param {number} type - Audit log event type
 * @param {number} limit - Number of entries to fetch
 * @returns {AuditLogEntry|null}
 */
async function fetchAuditLog(guild, type, limit = 1) {
  const cacheKey = `${guild.id}:${type}`;

  if (cache.has(cacheKey)) {
    const cached = cache.get(cacheKey);
    if (Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.entry;
    }
    cache.delete(cacheKey);
  }

  try {
    const logs = await guild.fetchAuditLogs({ limit, type });
    const entry = logs.entries.first();

    cache.set(cacheKey, { entry, timestamp: Date.now() });
    return entry;
  } catch (err) {
    logger.error(`Audit log fetch failed (type ${type}):`, err.message);
    return null;
  }
}

function clearCache() {
  cache.clear();
}

module.exports = { fetchAuditLog, clearCache };
