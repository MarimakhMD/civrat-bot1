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

/**
 * P9 — whitelist anti-bot : contrat de forme strict.
 *
 *  • ID_PATTERN — snowflake Discord stockable : 15 à 22 chiffres ASCII,
 *    même tolérance que EXEMPT_ID_PATTERN (AutoMod) et DISCORD_ID_PATTERN
 *    (Tickets / Welcome). Aucune conversion en nombre JS.
 *  • MAX_ENTRIES — plafond strict de la liste : après validation + dédup,
 *    seules les PREMIÈRES entrées sont conservées (aucune suppression
 *    arbitraire au milieu de la liste).
 *  • MODAL_MAX_LENGTH — longueur maximale du champ de modale (limite API
 *    Discord pour un TextInput).
 */
const SecurityWhitelist = Object.freeze({
  ID_PATTERN: /^\d{15,22}$/,
  MAX_ENTRIES: 100,
  MODAL_MAX_LENGTH: 4000,
});

/**
 * P9 — normalisation commune (écriture ET lecture) : garde les chaînes
 * valides selon ID_PATTERN, déduplique en préservant l'ordre de première
 * apparition, puis applique le plafond MAX_ENTRIES.
 *
 * • fonction pure, sans I/O ni appel réseau ;
 * • entrée non-tableau → [] (null / scalaire / undefined neutralisés) ;
 * • entrée non-string ou hors pattern → supprimée silencieusement (jamais
 *   de throw) ;
 * • ne convertit jamais en nombre JS ;
 * • n'altère jamais le tableau d'entrée (nouveau tableau retourné).
 */
function sanitizeWhitelistEntries(entries) {
  if (!Array.isArray(entries)) return [];
  const seen = new Set();
  const kept = [];
  for (const entry of entries) {
    if (typeof entry !== "string") continue;
    if (!SecurityWhitelist.ID_PATTERN.test(entry)) continue;
    if (seen.has(entry)) continue;
    seen.add(entry);
    kept.push(entry);
    if (kept.length >= SecurityWhitelist.MAX_ENTRIES) break;
  }
  return kept;
}

/**
 * P9 — texte brut de modale → liste validée : split(",") + trim, puis
 * validation stricte. Une soumission 100 % invalide produit [] ; une
 * soumission mixte ne conserve que les entrées valides (dans l'ordre).
 */
function parseWhitelistInput(raw) {
  const text = typeof raw === "string" ? raw : "";
  const tokens = text.split(",").map((token) => token.trim()).filter(Boolean);
  return sanitizeWhitelistEntries(tokens);
}

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

/**
 * P5 — détection ALERT-ONLY des rafales de modifications NON liées aux
 * permissions (channelUpdate / roleUpdate).
 *
 * Constantes DÉDIÉES et neuves : aucun seuil existant n'est touché
 * (SecurityNukeDefaults 10/12/30/32, SecurityRaidDefaults et
 * SecurityPermsDefaults 5/3 restent strictement inchangés).
 *
 *  • CHANNEL_DISTINCT_THRESHOLD — rafale de salons distincts dont un champ
 *    NON-permission a bougé (name/topic/position/parent/slowmode/nsfw/…)
 *    sur WINDOW_MS.
 *  • ROLE_DISTINCT_THRESHOLD — rafale de rôles distincts dont un champ
 *    NON-permission (name/color/hoist/mentionable) OU la position a bougé.
 *  • Une seule alerte par fenêtre (flag `alerted` du service + suppression).
 */
const SecurityUpdateDefaults = Object.freeze({
  WINDOW_MS: 15000,
  CHANNEL_DISTINCT_THRESHOLD: 10,
  ROLE_DISTINCT_THRESHOLD: 6,
});

module.exports = { SecurityConfigKey, SecurityComponentId, SECURITY_DEFAULTS, SecurityWhitelist, sanitizeWhitelistEntries, parseWhitelistInput, SecurityRaidDefaults, SecurityNukeDefaults, SecurityPermsDefaults, SecurityUpdateDefaults };
