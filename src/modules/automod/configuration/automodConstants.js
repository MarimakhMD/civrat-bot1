"use strict";

const AutoModConfigKey = Object.freeze({
  ENABLED: "automod_enabled",
  ANTI_SPAM: "automod_anti_spam",
  ANTI_LINKS: "automod_anti_links",
  ANTI_INVITES: "automod_anti_invites",
  ANTI_MENTION_SPAM: "automod_anti_mention_spam",
  MENTION_THRESHOLD: "automod_mention_threshold",
  ANTI_EMOJI_SPAM: "automod_anti_emoji_spam",
  EMOJI_THRESHOLD: "automod_emoji_threshold",
  ANTI_CAPS: "automod_anti_caps",
  CAPS_THRESHOLD: "automod_caps_threshold",
  BAD_WORDS: "automod_bad_words",
  DELETE_MESSAGE: "automod_delete_message",
  PUNISHMENT: "automod_punishment",
  TIMEOUT_MINUTES: "automod_timeout_minutes",
  // P7 — exemptions par rôle / par salon (sémantique OU, listes vides = strictement identique).
  EXEMPT_ROLES: "automod_exempt_roles",
  EXEMPT_CHANNELS: "automod_exempt_channels",
});

const AutoModComponentId = Object.freeze({
  SECTION: "civrat:v1:automod:section",
  TOGGLE: "civrat:v1:automod:enable",
  DELETE_MESSAGE: "civrat:v1:automod:delete",
  THRESHOLDS_OPEN: "civrat:v1:automod:thresholds-open",
  THRESHOLDS_MODAL: "civrat:v1:automod:thresholds",
  BAD_WORDS_OPEN: "civrat:v1:automod:badwords-open",
  BAD_WORDS_MODAL: "civrat:v1:automod:badwords",
  ENFORCE_SELECT: "civrat:v1:automod:enforce",
  TOGGLE_PREFIX: "civrat:v1:automod:rule",
  BACK: "civrat:v1:automod:back",
  // P7 — sous-vue « Exemptions ».
  //
  // CORRECTION ROUTES : ces customIds chevauchent VOLONTAIREMENT des routes
  // DÉJÀ enregistrées pour que les compteurs d'interaction (Phase 0) restent
  // strictement inchangés — AUCUNE nouvelle route n'est enregistrée.
  //  • les 4 boutons vivent sous le prefix `civrat:v1:automod:rule:`, déjà
  //    routé par la route prefix des toggles de règles ; le dispatch par
  //    segment (exempt-open / exempt-back / exempt-reset-*) est fait dans
  //    register.js ;
  //  • les 2 selects partagent la route prefix `civrat:v1:automod:`
  //    (merge avec ENFORCE_SELECT dans register.js).
  // Les composants NATIFS (role-select / channel-select) sont conservés.
  EXEMPT_OPEN: "civrat:v1:automod:rule:exempt-open",
  EXEMPT_ROLES_SELECT: "civrat:v1:automod:exempt-roles",
  EXEMPT_CHANNELS_SELECT: "civrat:v1:automod:exempt-channels",
  EXEMPT_RESET_ROLES: "civrat:v1:automod:rule:exempt-reset-roles",
  EXEMPT_RESET_CHANNELS: "civrat:v1:automod:rule:exempt-reset-channels",
  EXEMPT_BACK: "civrat:v1:automod:rule:exempt-back",
  /** Prefix unique de la route SELECT AutoMod (enforce + exemptions). */
  SELECT_PREFIX: "civrat:v1:automod:",
});

const AutoModPunishment = Object.freeze({
  NONE: "none",
  WARN: "warn",
  TIMEOUT: "timeout",
});

/**
 * P7 — limites des listes d'exemption.
 *
 * `EXEMPT_MAX_IDS` verrouille les deux listes à 10 entrées, à l'écriture
 * (validation des sélecteurs) ET au moment du merge avec le stockage.
 *
 * `EXEMPT_CHANNEL_TYPES` = texte (0) + annonces/news (5) uniquement.
 * Les catégories (4) et les threads (10/11/12) sont volontairement absents :
 * une exemption ne doit jamais désactive AutoMod sur une grande partie du
 * serveur via un parentId ou une catégorie englobante.
 */
const AutoModExemptLimits = Object.freeze({
  MAX_IDS: 10,
  CHANNEL_TYPES: Object.freeze([0, 5]),
});

/**
 * Forme d'un identifiant Discord (snowflake). Même tolérance que le pattern
 * déjà déployé dans tickets/XP : 15 à 22 chiffres.
 */
const EXEMPT_ID_PATTERN = /^\d{15,22}$/;

module.exports = { AutoModConfigKey, AutoModComponentId, AutoModPunishment, AutoModExemptLimits, EXEMPT_ID_PATTERN };
