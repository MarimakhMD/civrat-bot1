"use strict";
const { WelcomeGoodbyeConfigKey: Key } = require("./welcomeGoodbyeConstants");

const WelcomeGoodbyeDefaults = Object.freeze({ [Key.WELCOME_ENABLED]: false, [Key.GOODBYE_ENABLED]: false, [Key.WELCOME_CHANNEL]: null, [Key.GOODBYE_CHANNEL]: null, [Key.WELCOME_MESSAGE]: "Welcome {mention} to {server}!", [Key.GOODBYE_MESSAGE]: "Goodbye {username}!", [Key.WELCOME_EMBED]: false, [Key.GOODBYE_EMBED]: false, [Key.WELCOME_COLOR]: "#00e85c", [Key.GOODBYE_COLOR]: "#ff4444", [Key.WELCOME_DM]: false, [Key.WELCOME_DM_MESSAGE]: null, [Key.WELCOME_TEMPLATE]: "template-1", [Key.WELCOME_IMAGE_ENABLED]: false, [Key.WELCOME_IMAGE_KEY]: null });

/**
 * PHASE 2 (B6) — MESSAGES PAR DÉFAUT LOCALISÉS.
 *
 * `WelcomeGoodbyeDefaults` n'était référencé que par des tests : aucun chemin
 * de production ne l'appliquait. Un `welcome_message` absent ou vide en base
 * produisait donc `content: ""`, rejeté par l'API Discord — et, tant que le
 * salon et le DM n'étaient pas isolés (B1), cela faisait aussi perdre le DM.
 *
 * Le défaut est désormais appliqué à la LECTURE, dans la langue de la guilde
 * (`config.language`), et uniquement quand le contenu configuré est absent ou
 * vide. Un contenu explicitement saisi n'est jamais remplacé.
 *
 * Les valeurs de `WelcomeGoodbyeDefaults` (anglais) sont conservées telles
 * quelles pour la rétrocompatibilité des contrats existants.
 */
const WelcomeGoodbyeDefaultMessages = Object.freeze({
  fr: Object.freeze({
    welcome: "Bienvenue {mention} sur {server} !",
    goodbye: "Au revoir {username} !",
  }),
  en: Object.freeze({
    welcome: "Welcome {mention} to {server}!",
    goodbye: "Goodbye {username}!",
  }),
});

/** Langue de la guilde pour les contenus Welcome/Goodbye. Défaut : français. */
function resolveWelcomeGoodbyeLanguage(config) {
  return config && config.language === "en" ? "en" : "fr";
}

/**
 * Contenu à envoyer pour une clé de configuration donnée.
 *
 * @param {object} config ligne de configuration de la guilde
 * @param {string} key clé de configuration (`welcome_message`, …)
 * @param {"welcome"|"goodbye"} kind nature du message, pour le défaut
 * @returns {string} jamais vide
 */
function resolveConfiguredMessage(config, key, kind) {
  const configured = config ? config[key] : null;
  if (typeof configured === "string" && configured.trim().length > 0) return configured;
  const language = resolveWelcomeGoodbyeLanguage(config);
  const fallback = WelcomeGoodbyeDefaultMessages[language][kind];
  return fallback;
}

/**
 * Message du DM Welcome : message DM configuré, sinon message Welcome configuré,
 * sinon défaut dans la langue de la guilde. Jamais vide.
 *
 * Extrait ici pour que la LIVRAISON (`WelcomeDeliveryService.dm`) et l'APERÇU
 * (`welcomePreview`) appliquent exactement la même chaîne de repli — B5.
 */
function resolveWelcomeDmMessage(config) {
  const configured = config ? config[Key.WELCOME_DM_MESSAGE] : null;
  if (typeof configured === "string" && configured.trim().length > 0) return configured;
  return resolveConfiguredMessage(config, Key.WELCOME_MESSAGE, "welcome");
}

module.exports = { WelcomeGoodbyeDefaults, WelcomeGoodbyeDefaultMessages, resolveWelcomeGoodbyeLanguage, resolveConfiguredMessage, resolveWelcomeDmMessage };
