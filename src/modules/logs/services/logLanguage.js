"use strict";

/**
 * PHASE 1 — langue effective d'une entrée de log.
 *
 * Le rendu d'un log doit respecter la langue de la guilde dans SON INTÉGRALITÉ :
 * titre, libellés de champs et valeurs booléennes. La langue est donc résolue
 * une seule fois ici, attachée à l'entrée par chaque handler, puis consommée par
 * le transport. Défaut : français (langue historique du bot).
 */

const SUPPORTED_LANGUAGES = Object.freeze(["fr", "en"]);
const DEFAULT_LANGUAGE = "fr";

/** Résout la langue d'une entrée de log depuis la configuration de guilde. */
function resolveLanguage(config) {
  const value = config && typeof config.language === "string" ? config.language.toLowerCase() : null;
  return SUPPORTED_LANGUAGES.includes(value) ? value : DEFAULT_LANGUAGE;
}

module.exports = { resolveLanguage, SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE };
