"use strict";

const fr = require("../translations/fr.json");
const en = require("../translations/en.json");

const LOGS_FR = (fr && fr.logs) || {};
const LOGS_EN = (en && en.logs) || {};

// Résout un titre de log (`logs.member_kicked`, `logs.messageDeleted`, …)
// vers sa traduction FR/EN, selon la langue persistée de la guilde
// (`config.language`, défaut FR). Retourne `null` si la clé est inconnue :
// le transport retombe alors sur son titre générique — jamais de clé technique
// affichée à l'utilisateur.
function localizeTitle(config, key) {
  const language = config && config.language === "en" ? "en" : "fr";
  const dictionary = language === "en" ? LOGS_EN : LOGS_FR;
  const shortKey = typeof key === "string" ? key.replace(/^logs\./, "") : key;
  const value = dictionary[shortKey];
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

module.exports = { localizeTitle };
