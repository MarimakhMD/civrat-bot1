"use strict";

// A2 — alignement sur le schéma Supabase réel.
//
// Colonnes vérifiées en base : xp_enabled (bool), xp_per_message (integer,
// DEFAULT 15), xp_cooldown (integer, DEFAULT 60). Les anciennes clés
// `xp_rate` et `xp_channel_id` n'existent PAS en base : toute écriture les
// concernant faisait échouer l'upsert entier en PERSISTENCE_SCHEMA_MISMATCH.
// Elles sont supprimées, pas renommées (décision DCA4).

const XPConfigKey = Object.freeze({
  ENABLED: "xp_enabled",
  PER_MESSAGE: "xp_per_message",
  COOLDOWN: "xp_cooldown",
  ROLE_REWARDS: "role_rewards",
});

// Valeurs par défaut alignées sur les DEFAULT SQL réels.
const XP_DEFAULTS = Object.freeze({
  xp_enabled: false,
  xp_per_message: 15,
  xp_cooldown: 60,
  // A3 — colonne jsonb réelle, DEFAULT '[]' vérifié en base sur les deux
  // guildes existantes. [] signifie « aucune récompense ».
  role_rewards: [],
});

/**
 * A3 — bornes de validation de `role_rewards`.
 *
 * MAX_ENTRIES reprend la limite historique de l'ancien validateur
 * (src/api/server.js, architecture supprimée). MAX_ROLES_PER_ENTRY est la
 * borne décidée pour A3 : un niveau ne peut pas porter un nombre illimité de
 * rôles, ce qui limiterait aussi l'impact d'une configuration erronée.
 */
const XP_REWARD_LIMITS = Object.freeze({
  MAX_ENTRIES: 100,
  MAX_ROLES_PER_ENTRY: 10,
});

/**
 * Bornes de sécurité (décision DCA5).
 *
 * `xp_cooldown` est exprimé en SECONDES, 0 désactivant le cooldown, plafonné à
 * 3600 s. Toute valeur hors bornes, non numérique ou absente est ramenée à une
 * valeur sûre par XPService — jamais une exception.
 *
 * `xp_per_message` n'a pas de plafond imposé : seule une borne basse à 0 est
 * appliquée, un gain négatif étant physiquement impossible.
 */
const XP_LIMITS = Object.freeze({
  PER_MESSAGE_MIN: 0,
  COOLDOWN_SECONDS_MIN: 0,
  COOLDOWN_SECONDS_MAX: 3600,
});

// Identifiants des composants /settings XP.
//
// CHANNEL a été retiré en A2 (DCA4) : la restriction de l'XP à un salon
// s'appuyait sur la colonne inexistante xp_channel_id. Le test
// XPSettings.test.js verrouille sa disparition pour empêcher son retour.
const XPComponentId = Object.freeze({
  SECTION: "civrat:v1:xp:section",
  TOGGLE: "civrat:v1:xp:toggle",
  BACK: "civrat:v1:xp:back",
});

module.exports = { XPConfigKey, XPComponentId, XP_DEFAULTS, XP_LIMITS, XP_REWARD_LIMITS };
