"use strict";

const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function isPlainObject(value) {
  if (!value || Object.prototype.toString.call(value) !== "[object Object]") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (!isPlainObject(value)) return value;

  const clone = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!UNSAFE_KEYS.has(key)) clone[key] = cloneValue(entry);
  }
  return clone;
}

function mergeConfigDefaults(defaults = {}, persisted = {}) {
  const safeDefaults = isPlainObject(defaults) ? defaults : {};
  const safePersisted = isPlainObject(persisted) ? persisted : {};
  const merged = {};
  const keys = new Set([...Object.keys(safeDefaults), ...Object.keys(safePersisted)]);

  for (const key of keys) {
    if (UNSAFE_KEYS.has(key)) continue;

    const hasPersistedValue = Object.prototype.hasOwnProperty.call(safePersisted, key)
      && safePersisted[key] !== undefined;

    if (!hasPersistedValue) {
      if (Object.prototype.hasOwnProperty.call(safeDefaults, key)) {
        merged[key] = cloneValue(safeDefaults[key]);
      }
      continue;
    }

    const persistedValue = safePersisted[key];
    const defaultValue = safeDefaults[key];
    merged[key] = isPlainObject(defaultValue) && isPlainObject(persistedValue)
      ? mergeConfigDefaults(defaultValue, persistedValue)
      : cloneValue(persistedValue);
  }

  return merged;
}

module.exports = { mergeConfigDefaults };
