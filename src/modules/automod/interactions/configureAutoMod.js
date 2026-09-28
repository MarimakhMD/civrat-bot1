"use strict";

const { AutoModComponentId: Id, AutoModExemptLimits, EXEMPT_ID_PATTERN } = require("../configuration/automodConstants");
const { RULES } = require("./automodViews");
const { enforceConfigWrite } = require("../../../core/rateLimit/ActionRateLimitGuard");

const RULE_BY_NAME = Object.fromEntries(RULES.map((entry) => [entry.rule, entry.key]));

function toInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * P3-A — bornes d'écriture des seuils configurables (validation AVANT stockage).
 * Une valeur non finie garde le comportement historique de toInt (défaut) ;
 * une valeur fini hors plage est ramenée proprement à la borne la plus proche.
 * Jamais de -1, de 0 ni de valeur absurde stockée.
 *  - mention / emoji / caps : entier 1..100 (caps = pourcentage 1..100)
 *  - timeout : 1..40320 minutes, clamp identique à DiscordAutoModTransport
 */
const THRESHOLD_BOUNDS = Object.freeze({
  automod_mention_threshold: Object.freeze({ min: 1, max: 100 }),
  automod_emoji_threshold: Object.freeze({ min: 1, max: 100 }),
  automod_caps_threshold: Object.freeze({ min: 1, max: 100 }),
  automod_timeout_minutes: Object.freeze({ min: 1, max: 40320 }),
});

function toBoundedInt(value, fallback, { min, max }) {
  return Math.min(max, Math.max(min, toInt(value, fallback)));
}

async function toggleAutoModEnable(context) {
  const config = await context.service.read(context.guildId);
  return context.service.update(context.guildId, { automod_enabled: !config.automod_enabled });
}

async function toggleAutoModDelete(context) {
  const config = await context.service.read(context.guildId);
  return context.service.update(context.guildId, { automod_delete_message: !config.automod_delete_message });
}

async function toggleAutoModRule(context) {
  const rule = context.envelope.customId.split(":").pop();
  const key = RULE_BY_NAME[rule];
  if (!key) throw new Error(`Unknown AutoMod rule: ${rule}`);
  const config = await context.service.read(context.guildId);
  return context.service.update(context.guildId, { [key]: !config[key] });
}

async function openAutoModThresholds(context) {
  const config = await context.service.read(context.guildId);
  return context.envelope.transport.showModal({
    customId: Id.THRESHOLDS_MODAL,
    title: context.t("automod.thresholdsModalTitle"),
    fields: [
      { id: "mention_threshold", label: context.t("automod.fieldMentionThreshold"), value: String(config.automod_mention_threshold ?? 5) },
      { id: "emoji_threshold", label: context.t("automod.fieldEmojiThreshold"), value: String(config.automod_emoji_threshold ?? 8) },
      { id: "caps_threshold", label: context.t("automod.fieldCapsThreshold"), value: String(config.automod_caps_threshold ?? 70) },
      { id: "timeout_minutes", label: context.t("automod.fieldTimeoutMinutes"), value: String(config.automod_timeout_minutes ?? 10) },
    ],
  });
}

async function submitAutoModThresholds(context) {
  const values = context.envelope.modalValues || {};
  return context.service.update(context.guildId, {
    automod_mention_threshold: toBoundedInt(values.mention_threshold, 5, THRESHOLD_BOUNDS.automod_mention_threshold),
    automod_emoji_threshold: toBoundedInt(values.emoji_threshold, 8, THRESHOLD_BOUNDS.automod_emoji_threshold),
    automod_caps_threshold: toBoundedInt(values.caps_threshold, 70, THRESHOLD_BOUNDS.automod_caps_threshold),
    automod_timeout_minutes: toBoundedInt(values.timeout_minutes, 10, THRESHOLD_BOUNDS.automod_timeout_minutes),
  });
}

async function openAutoModBadWords(context) {
  const config = await context.service.read(context.guildId);
  const words = Array.isArray(config.automod_bad_words) ? config.automod_bad_words.join(", ") : "";
  return context.envelope.transport.showModal({
    customId: Id.BAD_WORDS_MODAL,
    title: context.t("automod.badWordsModalTitle"),
    fields: [{ id: "bad_words", label: context.t("automod.fieldBadWords"), value: words, required: false }],
  });
}

async function submitAutoModBadWords(context) {
  const raw = (context.envelope.modalValues && context.envelope.modalValues.bad_words) || "";
  const words = raw.split(",").map((word) => word.trim()).filter(Boolean);
  return context.service.update(context.guildId, { automod_bad_words: words });
}

async function selectAutoModEnforcement(context) {
  const value = (context.envelope.values && context.envelope.values[0]) || "none";
  return context.service.update(context.guildId, { automod_punishment: value });
}

// ─────────────────────────────────────────────────────────────────────────────
// P7 — exemptions par rôle / par salon
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Guild de l'interaction, pour la validation des IDs reçus des selects.
 * Un route MANAGE_GUILD est toujours exécuté en guilde : si la guild est
 * indisponible, on ignore les valeurs (incapacité de valider → jamais
 * d'exception, GO §4).
 */
function resolveExemptGuild(context) {
  return (context.envelope && (context.envelope.discordMember?.guild || context.envelope.discordChannel?.guild)) || null;
}

/**
 * Validation d'une sélection reçue d'un select NATIF — jamais de confiance
 * aveugle (GO §4) :
 *  - forme snowflake (EXEMPT_ID_PATTERN), sinon ignoré ;
 *  - `@everyone` exclu explicitement (son ID est celui de la guilde) ;
 *  - dédupliqué via Set ;
 *  - appartenance à la guilde vérifiée via les caches (roles.cache /
 *    channels.cache) — zéro fetch Discord ;
 *  - salons : type texte (0) ou annonce (5) UNIQUEMENT — catégories (4) et
 *    threads (10/11/12) rejetés même s'ils traversaient le select ;
 *  - plafond EXEMPT_MAX_IDS (10) ;
 *  - toute valeur non validable est ignorée proprement, sans exception.
 */
function sanitizeExemptSelection(values, { kind, guild, guildId }) {
  const selected = Array.isArray(values) ? values : [];
  const everyoneId = (guild && guild.roles && guild.roles.everyone && guild.roles.everyone.id) || guildId;
  const accepted = [];
  const seen = new Set();
  for (const raw of selected) {
    if (accepted.length >= AutoModExemptLimits.MAX_IDS) break;
    if (typeof raw !== "string" || !EXEMPT_ID_PATTERN.test(raw)) continue;
    if (raw === everyoneId) continue;
    if (seen.has(raw)) continue;
    if (!guild) continue; // non validable → ignoré proprement
    if (kind === "role") {
      if (!guild.roles || !guild.roles.cache || !guild.roles.cache.has(raw)) continue;
    } else {
      const channel = guild.channels && guild.channels.cache && guild.channels.cache.get(raw);
      if (!channel) continue;
      if (!AutoModExemptLimits.CHANNEL_TYPES.includes(channel.type)) continue;
    }
    seen.add(raw);
    accepted.push(raw);
  }
  return accepted;
}

/**
 * Merge sélection validée ∪ stockage, avec re-validation MINIMALE du stockage
 * (forme snowflake + exclusion `@everyone`, sans exiger que l'objet existe
 * encore en cache) : un ID obsolète (rôle/salon supprimé) reste stocké et se
 * nettoie manuellement via Reset (GO §6), il n'exempte plus personne au
 * runtime (`roles.cache.has` / comparaison channelId). Plafond final à 10.
 */
function mergeExemptList(stored, incoming, { guildId }) {
  const everyoneId = guildId;
  const merged = [];
  const seen = new Set();
  const push = (id) => {
    if (typeof id !== "string" || !EXEMPT_ID_PATTERN.test(id)) return;
    if (id === everyoneId) return;
    if (seen.has(id)) return;
    seen.add(id);
    merged.push(id);
  };
  for (const id of incoming) push(id);
  for (const id of Array.isArray(stored) ? stored : []) push(id);
  return merged.slice(0, AutoModExemptLimits.MAX_IDS);
}

/**
 * Écriture d'une liste d'exemption — TOUJOURS après `enforceConfigWrite`
 * (P6 §5, 30/60 s par guild+user) et AVANT l'upsert. Au dépassement :
 * réponse éphémère déjà envoyée par la garde, retour `null`, aucun write.
 */
async function updateExemptList(context, key, incomingValues, kind) {
  if (!(await enforceConfigWrite(context))) return null;
  const guild = resolveExemptGuild(context);
  const incoming = sanitizeExemptSelection(incomingValues, { kind, guild, guildId: context.guildId });
  const config = await context.service.read(context.guildId);
  const merged = mergeExemptList(config[key], incoming, { guildId: context.guildId });
  return context.service.update(context.guildId, { [key]: merged });
}

async function selectAutoModExemptRoles(context) {
  return updateExemptList(context, "automod_exempt_roles", context.envelope.values, "role");
}

async function selectAutoModExemptChannels(context) {
  return updateExemptList(context, "automod_exempt_channels", context.envelope.values, "channel");
}

/** Reset rôles : la liste devient []. Rate-limit P6 identique aux selects. */
async function resetAutoModExemptRoles(context) {
  if (!(await enforceConfigWrite(context))) return null;
  return context.service.update(context.guildId, { automod_exempt_roles: [] });
}

/** Reset salons : la liste devient []. Rate-limit P6 identique aux selects. */
async function resetAutoModExemptChannels(context) {
  if (!(await enforceConfigWrite(context))) return null;
  return context.service.update(context.guildId, { automod_exempt_channels: [] });
}

module.exports = {
  toggleAutoModEnable,
  toggleAutoModDelete,
  toggleAutoModRule,
  openAutoModThresholds,
  submitAutoModThresholds,
  openAutoModBadWords,
  submitAutoModBadWords,
  selectAutoModEnforcement,
  // P7 — exemptions rôle / salon.
  selectAutoModExemptRoles,
  selectAutoModExemptChannels,
  resetAutoModExemptRoles,
  resetAutoModExemptChannels,
};
