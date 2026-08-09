"use strict";

function flatten(object, prefix = "") {
  return Object.entries(object).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return value && typeof value === "object" && !Array.isArray(value)
      ? flatten(value, path)
      : [[path, value]];
  });
}

function variableNames(template) {
  return [...String(template).matchAll(/{{\s*([a-zA-Z0-9_]+)\s*}}/g)].map((match) => match[1]).sort();
}

/** Throws when locales do not expose exactly the same translation contract. */
function validateTranslationParity(dictionaries, referenceLocale = "en") {
  const reference = new Map(flatten(dictionaries[referenceLocale] || {}));
  if (!reference.size) throw new Error(`Reference locale "${referenceLocale}" is empty.`);

  for (const [locale, dictionary] of Object.entries(dictionaries)) {
    const entries = new Map(flatten(dictionary));
    const keys = new Set([...reference.keys(), ...entries.keys()]);
    for (const key of keys) {
      if (!reference.has(key) || !entries.has(key)) {
        throw new Error(`Translation key parity failure for locale "${locale}": ${key}`);
      }
      if (typeof reference.get(key) !== "string" || typeof entries.get(key) !== "string") {
        throw new Error(`Translation value must be a string for locale "${locale}": ${key}`);
      }
      if (variableNames(reference.get(key)).join(",") !== variableNames(entries.get(key)).join(",")) {
        throw new Error(`Translation variable parity failure for locale "${locale}": ${key}`);
      }
    }
  }
  return true;
}

module.exports = { flatten, variableNames, validateTranslationParity };
