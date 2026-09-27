"use strict";

const { AutoModComponentId: Id } = require("../configuration/automodConstants");
const { RULES } = require("./automodViews");

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

module.exports = {
  toggleAutoModEnable,
  toggleAutoModDelete,
  toggleAutoModRule,
  openAutoModThresholds,
  submitAutoModThresholds,
  openAutoModBadWords,
  submitAutoModBadWords,
  selectAutoModEnforcement,
};
