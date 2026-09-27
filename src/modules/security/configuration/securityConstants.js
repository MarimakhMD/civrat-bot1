"use strict";

const SecurityConfigKey = Object.freeze({
  ENABLED: "security_enabled",
  ANTI_RAID: "security_anti_raid",
  ANTI_BOT: "security_anti_bot",
  WHITELIST: "security_whitelist",
  ANTI_NUKE: "security_anti_nuke",
  LOG_CHANNEL_ID: "security_log_channel_id",
});

const SecurityComponentId = Object.freeze({
  SECTION: "civrat:v1:security:section",
  TOGGLE: "civrat:v1:security:toggle",
  ANTI_RAID: "civrat:v1:security:anti-raid",
  ANTI_BOT: "civrat:v1:security:anti-bot",
  ANTI_NUKE: "civrat:v1:security:anti-nuke",
  WHITELIST_OPEN: "civrat:v1:security:whitelist-open",
  WHITELIST_MODAL: "civrat:v1:security:whitelist",
  BACK: "civrat:v1:security:back",
});

const SECURITY_DEFAULTS = Object.freeze({
  security_enabled: false,
  security_anti_raid: false,
  security_anti_bot: false,
  security_whitelist: [],
  security_anti_nuke: false,
  security_log_channel_id: null,
});

const SecurityRaidDefaults = Object.freeze({
  WINDOW_MS: 15000,
  THRESHOLD: 5,
});

const SecurityNukeDefaults = Object.freeze({
  WINDOW_MS: 15000,
  THRESHOLDS: Object.freeze({
    channelCreate: 10,
    channelDelete: 12,
    roleCreate: 30,
    roleDelete: 32,
  }),
});

/**
 * P2-B — détection ALERT-ONLY des modifications dangereuses de permissions.
 *
 * Constantes DÉDIÉES et neuves : aucun seuil existant n'est touché
 * (SecurityNukeDefaults 10/12/30/32 et SecurityRaidDefaults restent strictement
 * inchangés, SecurityRaidService n'est pas réutilisé).
 *
 *  • CHANNEL_DISTINCT_THRESHOLD — rafale d'overwrites de salon : 5 salons
 *    DISTINCTS sur WINDOW_MS.
 *  • ROLE_DISTINCT_THRESHOLD — rafale de modifications de permissions de rôle :
 *    3 rôles DISTINCTS sur WINDOW_MS.
 *  • ESCALATION_COOLDOWN_MS — anti-boucle du signal fort N1 (gain d'une
 *    permission sensible sur une même cible).
 *  • SENSITIVE_PERMISSIONS — liste initiale des permissions sensibles ; un
 *    GAIN de l'une d'elles déclenche N1 (une perte n'est jamais un signal).
 */
const SecurityPermsDefaults = Object.freeze({
  WINDOW_MS: 15000,
  CHANNEL_DISTINCT_THRESHOLD: 5,
  ROLE_DISTINCT_THRESHOLD: 3,
  ESCALATION_COOLDOWN_MS: 15000,
  SENSITIVE_PERMISSIONS: Object.freeze([
    "Administrator",
    "ManageGuild",
    "ManageRoles",
    "ManageChannels",
    "BanMembers",
    "KickMembers",
    "ManageWebhooks",
  ]),
});

module.exports = { SecurityConfigKey, SecurityComponentId, SECURITY_DEFAULTS, SecurityRaidDefaults, SecurityNukeDefaults, SecurityPermsDefaults };
