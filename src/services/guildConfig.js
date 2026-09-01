"use strict";

const logger = require("../utils/logger");
const {
  ErrorCode,
  BackendUnavailableError,
  PersistenceError,
  ValidationError,
} = require("../core/errors");
const {
  SupabaseErrorCategory,
  classifySupabaseError,
  toPersistenceError,
} = require("../adapters/supabase/supabaseErrorClassifier");
// A1 — liste blanche statique des colonnes de guild_configs.
const { isGuildConfigKey, SERVICE_MANAGED_KEYS } = require("./guildConfigKeys");

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map(); // guildId -> { config, expiresAt, found }
let databaseProvider = () => require("../config/database");

function getDatabase() {
  try {
    const database = databaseProvider() || {};
    return {
      client: database.supabaseAdmin || database.supabase || null,
      state: database.databaseState || null,
    };
  } catch {
    return { client: null, state: null };
  }
}

function cloneConfig(config) {
  return config && typeof config === "object" && !Array.isArray(config) ? { ...config } : {};
}

function createState({ config = {}, available, found, source, reason = null }) {
  return {
    config: cloneConfig(config),
    available: Boolean(available),
    found: Boolean(found),
    source,
    reason,
  };
}

function cachedUnavailableState(cached, reason) {
  if (!cached) {
    return createState({ config: {}, available: false, found: false, source: "unavailable", reason });
  }
  return createState({
    config: cached.config,
    available: false,
    found: cached.found,
    source: "stale-cache",
    reason,
  });
}

function safeErrorMetadata(classified, guildId, operation) {
  return {
    guildId,
    operation,
    classification: classified.category,
    errorCode: classified.code,
    httpStatus: classified.httpStatus,
  };
}

function logPersistenceFailure(message, classified, guildId, operation) {
  const level = classified.retryable ? "warn" : "error";
  const writer = logger[level] || logger.error;
  writer.call(logger, message, safeErrorMetadata(classified, guildId, operation));
}

async function getGuildConfigState(guildId) {
  if (!guildId || typeof guildId !== "string") {
    return createState({
      config: {},
      available: false,
      found: false,
      source: "invalid",
      reason: "INVALID_GUILD_ID",
    });
  }

  const now = Date.now();
  const cached = cache.get(guildId);
  if (cached && cached.expiresAt > now) {
    return createState({
      config: cached.config,
      available: true,
      found: cached.found,
      source: "cache",
      reason: null,
    });
  }

  const { client } = getDatabase();
  if (!client) return cachedUnavailableState(cached, ErrorCode.BACKEND_UNAVAILABLE);

  try {
    const { data, error } = await client
      .from("guild_configs")
      .select("*")
      .eq("guild_id", guildId)
      .maybeSingle();

    if (error) {
      const classified = classifySupabaseError(error);
      if (classified.category === SupabaseErrorCategory.NOT_FOUND) {
        const empty = { config: {}, expiresAt: now + CACHE_TTL_MS, found: false };
        cache.set(guildId, empty);
        return createState({ config: {}, available: true, found: false, source: "database", reason: null });
      }

      logPersistenceFailure("Guild configuration read failed", classified, guildId, "read");
      return cachedUnavailableState(cached, classified.category);
    }

    const found = Boolean(data && typeof data === "object" && !Array.isArray(data));
    const config = found ? cloneConfig(data) : {};
    cache.set(guildId, { config, expiresAt: now + CACHE_TTL_MS, found });
    return createState({ config, available: true, found, source: "database", reason: null });
  } catch (error) {
    const classified = classifySupabaseError(error);
    logPersistenceFailure("Guild configuration read failed", classified, guildId, "read");
    return cachedUnavailableState(cached, classified.category);
  }
}

async function getGuildConfig(guildId) {
  return (await getGuildConfigState(guildId)).config;
}

Object.defineProperty(getGuildConfig, "getState", {
  value: getGuildConfigState,
  enumerable: false,
  configurable: false,
  writable: false,
});

function validateUpdate(guildId, patch) {
  if (!guildId || typeof guildId !== "string") {
    throw new ValidationError("guildId must be a non-empty string", { resource: "guild_config" });
  }
  if (!patch || typeof patch !== "object" || Array.isArray(patch) || Object.keys(patch).length === 0) {
    throw new ValidationError("patch must be a non-empty object", { resource: "guild_config" });
  }
  if (Object.prototype.hasOwnProperty.call(patch, "guild_id")) {
    throw new ValidationError("guild_id cannot be changed through a configuration patch", { resource: "guild_config" });
  }

  // A1 — Liste blanche des colonnes de guild_configs.
  //
  // Sans ce contrôle, PostgREST rejetait l'UPSERT ENTIER dès qu'une colonne
  // était inconnue, et l'erreur remontait en PERSISTENCE_FAILED : impossible de
  // savoir quelle clé était en cause, et tous les réglages du même appel étaient
  // perdus. Le défaut est désormais nommé, localisé et levé AVANT tout I/O.
  //
  // Décision DCA2 = R1 : rejet strict. Aucun filtrage silencieux — une clé
  // écartée sans bruit reproduirait exactement le problème qu'on corrige.
  const unknown = Object.keys(patch).filter((key) => !isGuildConfigKey(key));
  if (unknown.length > 0) {
    const managed = unknown.filter((key) => SERVICE_MANAGED_KEYS.includes(key));
    throw new ValidationError(
      managed.length > 0
        ? `unknown guild_config key(s): ${unknown.join(", ")} — ${managed.join(", ")} is managed by the service and must not be provided`
        : `unknown guild_config key(s): ${unknown.join(", ")} — declare it in src/services/guildConfigKeys.js`,
      { resource: "guild_config", unknownKeys: unknown },
    );
  }
}

function cleanPatch(patch) {
  return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
}

async function updateGuildConfig(guildId, patch) {
  validateUpdate(guildId, patch);
  const persistedPatch = cleanPatch(patch);
  if (Object.keys(persistedPatch).length === 0) {
    throw new ValidationError("patch must contain at least one defined value", { resource: "guild_config" });
  }

  const { client } = getDatabase();
  if (!client) {
    throw new BackendUnavailableError({ operation: "write", resource: "guild_config", source: "supabase" });
  }

  try {
    const payload = { guild_id: guildId, ...persistedPatch, updated_at: new Date().toISOString() };
    const { data, error } = await client
      .from("guild_configs")
      .upsert(payload, { onConflict: "guild_id" })
      .select("*")
      .maybeSingle();

    if (error) {
      const classified = classifySupabaseError(error);
      logPersistenceFailure("Guild configuration write failed", classified, guildId, "write");
      throw toPersistenceError(error, { operation: "write", resource: "guild_config" });
    }

    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new PersistenceError({
        code: ErrorCode.PERSISTENCE_FAILED,
        metadata: { operation: "write", resource: "guild_config", source: "supabase", reason: "NO_CONFIRMED_ROW" },
      });
    }

    const config = cloneConfig(data);
    cache.set(guildId, { config, expiresAt: Date.now() + CACHE_TTL_MS, found: true });
    return config;
  } catch (error) {
    if (error instanceof BackendUnavailableError || error instanceof PersistenceError) throw error;
    const classified = classifySupabaseError(error);
    logPersistenceFailure("Guild configuration write failed", classified, guildId, "write");
    throw toPersistenceError(error, { operation: "write", resource: "guild_config" });
  }
}

async function invalidateCache(guildId) {
  if (guildId) cache.delete(guildId);
  else cache.clear();
}

async function getAllGuildConfigs() {
  const { client } = getDatabase();
  if (!client) {
    throw new BackendUnavailableError({ operation: "read_all", resource: "guild_config", source: "supabase" });
  }

  try {
    const { data, error } = await client.from("guild_configs").select("*");
    if (error) throw error;
    if (!Array.isArray(data)) {
      throw new PersistenceError({
        metadata: { operation: "read_all", resource: "guild_config", source: "supabase", reason: "INVALID_RESPONSE" },
      });
    }
    return data.map(cloneConfig);
  } catch (error) {
    if (error instanceof BackendUnavailableError || error instanceof PersistenceError) throw error;
    const classified = classifySupabaseError(error);
    logPersistenceFailure("Guild configurations read failed", classified, null, "read_all");
    throw toPersistenceError(error, { operation: "read_all", resource: "guild_config" });
  }
}

function _getCache() {
  return cache;
}

function _setCache(guildId, config, expiresAt = Date.now() + CACHE_TTL_MS, found = null) {
  const normalized = cloneConfig(config);
  cache.set(guildId, {
    config: normalized,
    expiresAt,
    found: found === null ? Object.keys(normalized).length > 0 : Boolean(found),
  });
}

function _setDatabaseProvider(provider = null) {
  databaseProvider = typeof provider === "function" ? provider : () => require("../config/database");
}

module.exports = {
  getGuildConfig,
  getGuildConfigState,
  updateGuildConfig,
  invalidateCache,
  getAllGuildConfigs,
  _getCache,
  _setCache,
  _setDatabaseProvider,
  CACHE_TTL_MS,
};
