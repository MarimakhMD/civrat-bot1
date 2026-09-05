"use strict";

/**
 * A1 — Liste blanche statique des colonnes de public.guild_configs.
 *
 * POURQUOI CE FICHIER EXISTE
 * --------------------------
 * `updateGuildConfig()` upsertait n'importe quelle clé reçue. Or PostgREST
 * rejette l'UPSERT ENTIER dès qu'une colonne est inconnue : une seule clé mal
 * nommée faisait donc échouer tous les réglages du même appel, et l'erreur
 * remontait en PERSISTENCE_FAILED — jamais « colonne inconnue ».
 *
 * C'est exactement le défaut corrigé en C1 sur `giveaway_enabled`. Il était
 * encore vivant sur `xp_channel_id` après A1, qui l'avait laissée dans la liste
 * pour ne changer aucun comportement ; A2 (DCA4) l'a supprimée du module XP.
 * Les deux colonnes fantômes figurent désormais dans EXCLUDED_NON_CONFIG_KEYS.
 *
 * STRATÉGIE RETENUE (décision DCA1 = S1)
 * --------------------------------------
 * Liste statique, aucune lecture d'information_schema au runtime : le résultat
 * est déterministe, testable hors ligne et ne dépend pas de l'état de la base.
 *
 * Un garde-fou de test (guildConfigWhitelist.test.js) compare cette liste aux
 * clés réellement référencées par les modules : ajouter une clé de configuration
 * sans la déclarer ici fait échouer la suite au lieu de casser la production.
 *
 * CE QUI N'EST PAS UNE CLÉ DE CONFIGURATION
 * -----------------------------------------
 * Les constantes des modules mélangent trois familles homonymes en snake_case.
 * Seule la première appartient à cette liste :
 *   • clés de guild_configs            → ICI
 *   • componentIds Discord             → exclus (suggestion_up, giveaway_join…)
 *   • champs de modale / d'audit       → exclus (master_code, admin_plan…)
 * Les 16 faux positifs identifiés sont listés en bas de ce fichier.
 *
 * `guild_id` et `updated_at` sont volontairement ABSENTS : ils sont ajoutés par
 * updateGuildConfig() lui-même et ne doivent jamais venir d'un appelant.
 */

/** Réglages généraux de guilde. */
const GENERAL_KEYS = Object.freeze([
  "language",
]);

/** Analytics. */
const ANALYTICS_KEYS = Object.freeze([
  "analytics_enabled",
]);

/** AutoMod. */
const AUTOMOD_KEYS = Object.freeze([
  "automod_enabled",
  "automod_anti_spam",
  "automod_anti_links",
  "automod_anti_invites",
  "automod_anti_caps",
  "automod_anti_emoji_spam",
  "automod_anti_mention_spam",
  "automod_bad_words",
  "automod_caps_threshold",
  "automod_emoji_threshold",
  "automod_mention_threshold",
  "automod_delete_message",
  "automod_punishment",
  "automod_timeout_minutes",
]);

/** AutoRole. */
const AUTOROLE_KEYS = Object.freeze([
  "autorole_enabled",
  "autorole_member_role_id",
  "autorole_bot_role_id",
]);

/**
 * CAPTCHA — module GELÉ.
 *
 * Ces clés sont déclarées pour ne pas casser un réglage existant, mais aucun
 * fichier de src/modules/captcha/** n'est modifié par A1.
 */
const CAPTCHA_KEYS = Object.freeze([
  "captcha_enabled",
  "captcha_channel_id",
  "captcha_role_id",
]);

/** Giveaways. */
const GIVEAWAYS_KEYS = Object.freeze([
  "giveaways_enabled",
]);

/** Invitations. */
const INVITES_KEYS = Object.freeze([
  "invitations_enabled",
  "invitations_log_channel_id",
]);

/** Logs. */
const LOGS_KEYS = Object.freeze([
  "logs_enabled",
  "log_moderation_channel_id",
  "log_member_join_channel_id",
  "log_member_leave_channel_id",
  "log_message_edit_channel_id",
  "log_message_delete_channel_id",
  "log_channel_update_channel_id",
  "log_role_update_channel_id",
]);

/** Sécurité. */
const SECURITY_KEYS = Object.freeze([
  "security_enabled",
  "security_anti_bot",
  "security_anti_raid",
  "security_anti_nuke",
  "security_log_channel_id",
  "security_whitelist",
]);

/** Suggestions. */
const SUGGESTIONS_KEYS = Object.freeze([
  "suggestions_enabled",
  "suggestions_channel_id",
]);

/** Salons vocaux temporaires. */
const TEMPVOICE_KEYS = Object.freeze([
  "tempvoice_enabled",
  "tempvoice_category_id",
  "tempvoice_lobby_channel_id",
]);

/** Tickets — parcours Free. */
const TICKETS_FREE_KEYS = Object.freeze([
  "tickets_enabled",
  "ticket_category_id",
  "ticket_support_role_id",
  "ticket_log_channel_id",
]);

/**
 * Tickets — personnalisation Premium.
 *
 * Les 8 clés sont consommées par TicketPremiumConfigResolver, et uniquement
 * quand l'entitlement TICKET_PREMIUM est actif. Les exclure de la liste
 * casserait toute la personnalisation Premium.
 */
const TICKETS_PREMIUM_KEYS = Object.freeze([
  "ticket_panel_title",
  "ticket_panel_description",
  "ticket_panel_color",
  "ticket_panel_image_url",
  "ticket_create_button_label",
  "ticket_name_format",
  "ticket_welcome_message",
  "ticket_transcript_channel_id",
]);

/** Welcome / Goodbye. */
const WELCOME_GOODBYE_KEYS = Object.freeze([
  "welcome_enabled",
  "welcome_channel_id",
  "welcome_message",
  "welcome_embed_enabled",
  "welcome_embed_color",
  "welcome_dm_enabled",
  "welcome_dm_message",
  "welcome_template_id",
  "goodbye_enabled",
  "goodbye_channel_id",
  "goodbye_message",
  "goodbye_embed_enabled",
  "goodbye_embed_color",
]);

/**
 * XP.
 *
 * A2 — aligné sur le schéma Supabase réel vérifié : `xp_enabled` (bool),
 * `xp_per_message` (integer, DEFAULT 15) et `xp_cooldown` (integer,
 * DEFAULT 60, en secondes).
 *
 * `xp_rate` et `xp_channel_id` ont été SUPPRIMÉES du code et de cette liste
 * (décisions DCA3/DCA4) : ces colonnes n'existent pas en base et toute écriture
 * les concernant faisait échouer l'upsert entier. Elles figurent désormais dans
 * EXCLUDED_NON_CONFIG_KEYS pour empêcher leur réintroduction.
 *
 * A3 — `role_rewards` (jsonb, DEFAULT '[]' vérifié en base) porte les rôles
 * accordés par niveau atteint. Elle est déclarée ICI et dans XPConfigKey dans
 * le même changement : le garde-fou bidirectionnel de
 * guildConfigWhitelist.test.js exige que toute clé d'un module figure dans
 * cette liste, et réciproquement.
 *
 * `level_rewards` (jsonb) est VOLONTAIREMENT ABSENTE. L'historique du dépôt
 * (commits 027f8c4 / d56ab7b, architecture supprimée) montre qu'elle désignait
 * la COURBE de niveaux ({level, xp_required}) et non des rôles — et qu'elle
 * n'a jamais été consommée, la formule étant codée en dur. L'activer imposerait
 * de changer LevelService et d'invalider les niveaux déjà stockés dans
 * member_xp. Elle reste donc une colonne inactive, non inscriptible par le
 * code, en attendant une décision dédiée.
 */
const XP_KEYS = Object.freeze([
  "xp_enabled",
  "xp_per_message",
  "xp_cooldown",
  "role_rewards",
]);

/**
 * Colonnes gérées par updateGuildConfig() lui-même.
 *
 * Jamais acceptées en entrée : `guild_id` est la cible de l'upsert et
 * `updated_at` est horodaté par le service. Les accepter laisserait un
 * appelant écraser l'identité de la ligne ou figer un horodatage faux.
 */
const SERVICE_MANAGED_KEYS = Object.freeze(["guild_id", "updated_at"]);

/**
 * Faux positifs délibérément EXCLUS — documentés pour qu'une relecture ne les
 * réintroduise pas. Aucun n'est une colonne de guild_configs.
 */
const EXCLUDED_NON_CONFIG_KEYS = Object.freeze([
  // componentIds Discord (boutons de vote et d'approbation)
  "suggestion_up", "suggestion_down", "suggestion_approve", "suggestion_reject",
  "suggestion_delete", "giveaway_join",
  // champs de modale Recovery / Owner
  "master_code", "temp_code", "owner_panel_master_code", "owner_transfer_code",
  "target_discord_id", "new_owner_discord_id",
  // champs de modale et colonnes d'audit Admin
  "admin_guild_id", "admin_plan", "admin_expires_in_days", "admin_reason",
  // colonnes XP fantômes, supprimées en A2 (DCA3/DCA4) : elles n'existent pas
  // en base et ne doivent jamais revenir dans un patch de configuration
  "xp_rate", "xp_channel_id",
]);

const GUILD_CONFIG_KEY_GROUPS = Object.freeze({
  general: GENERAL_KEYS,
  analytics: ANALYTICS_KEYS,
  automod: AUTOMOD_KEYS,
  autorole: AUTOROLE_KEYS,
  captcha: CAPTCHA_KEYS,
  giveaways: GIVEAWAYS_KEYS,
  invites: INVITES_KEYS,
  logs: LOGS_KEYS,
  security: SECURITY_KEYS,
  suggestions: SUGGESTIONS_KEYS,
  tempvoice: TEMPVOICE_KEYS,
  ticketsFree: TICKETS_FREE_KEYS,
  ticketsPremium: TICKETS_PREMIUM_KEYS,
  welcomeGoodbye: WELCOME_GOODBYE_KEYS,
  xp: XP_KEYS,
});

/** Liste plate, ordre stable, sans doublon. */
const GUILD_CONFIG_KEYS = Object.freeze(
  Object.values(GUILD_CONFIG_KEY_GROUPS).flat().slice().sort(),
);

/** Set de recherche O(1) pour la validation. */
const GUILD_CONFIG_KEY_SET = Object.freeze(new Set(GUILD_CONFIG_KEYS));

/** true si la clé est une colonne de guild_configs déclarée. */
function isGuildConfigKey(key) {
  return typeof key === "string" && GUILD_CONFIG_KEY_SET.has(key);
}

module.exports = {
  GUILD_CONFIG_KEYS,
  GUILD_CONFIG_KEY_SET,
  GUILD_CONFIG_KEY_GROUPS,
  SERVICE_MANAGED_KEYS,
  EXCLUDED_NON_CONFIG_KEYS,
  isGuildConfigKey,
};
