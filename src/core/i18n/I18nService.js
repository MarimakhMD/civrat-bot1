"use strict";

const { resolveGuildLocale } = require("./locale");

class TranslationMissingError extends Error {
  constructor(locale, key) {
    super(`Missing translation key "${key}" for locale "${locale}"`);
    this.name = "TranslationMissingError";
    this.locale = locale;
    this.key = key;
  }
}

/**
 * Small translation service for the core contract. It never falls back to a
 * different language: missing translations are explicit development errors.
 */
class I18nService {
  constructor({ dictionaries, logger = null }) {
    this.dictionaries = Object.freeze({ ...dictionaries });
    this.logger = logger;
  }

  translate(locale, key, variables = {}) {
    const resolvedLocale = resolveGuildLocale(locale);
    const template = getByPath(this.dictionaries[resolvedLocale], key);
    if (typeof template !== "string") {
      this.logger?.error?.("Core translation key is missing", { locale: resolvedLocale, key });
      throw new TranslationMissingError(resolvedLocale, key);
    }
    return interpolate(template, variables);
  }

  forLocale(locale) {
    const resolvedLocale = resolveGuildLocale(locale);
    return (key, variables) => this.translate(resolvedLocale, key, variables);
  }
}

function getByPath(object, dottedPath) {
  return dottedPath.split(".").reduce((value, key) => (
    value && Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined
  ), object);
}

function interpolate(template, variables) {
  return template.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (match, name) => (
    Object.prototype.hasOwnProperty.call(variables, name) ? String(variables[name]) : match
  ));
}

module.exports = { I18nService, TranslationMissingError, getByPath, interpolate };
