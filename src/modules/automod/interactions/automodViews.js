"use strict";

const { AutoModComponentId: Id, AutoModExemptLimits } = require("../configuration/automodConstants");

const RULES = [
  { rule: "antiSpam", key: "automod_anti_spam" },
  { rule: "antiLinks", key: "automod_anti_links" },
  { rule: "antiInvites", key: "automod_anti_invites" },
  { rule: "antiMentionSpam", key: "automod_anti_mention_spam" },
  { rule: "antiEmojiSpam", key: "automod_anti_emoji_spam" },
  { rule: "antiCaps", key: "automod_anti_caps" },
];

function ruleToggle(t, config, rule, key) {
  const on = Boolean(config[key]);
  return {
    type: "button",
    customId: `${Id.TOGGLE_PREFIX}:${rule}`,
    label: `${on ? "✅ " : "⬜ "}${t(`automod.rule.${rule}`)}`,
    style: on ? "success" : "secondary",
  };
}

function autoModView({ t, config }) {
  const enabled = Boolean(config.automod_enabled);
  const deleteOn = Boolean(config.automod_delete_message);
  return {
    title: t("automod.title"),
    content: t(enabled ? "automod.enabled" : "automod.disabled"),
    components: [
      { type: "button", customId: Id.TOGGLE, label: t(enabled ? "automod.disable" : "automod.enable"), style: enabled ? "success" : "secondary" },
      { type: "button", customId: Id.DELETE_MESSAGE, label: `${deleteOn ? "✅ " : "⬜ "}${t("automod.deleteMessage")}`, style: deleteOn ? "success" : "secondary" },
      ...RULES.map(({ rule, key }) => ruleToggle(t, config, rule, key)),
      { type: "button", customId: Id.BAD_WORDS_OPEN, label: t("automod.configureBadWords"), style: "primary" },
      { type: "button", customId: Id.THRESHOLDS_OPEN, label: t("automod.configureThresholds"), style: "primary" },
      // P7 — entrée vers la sous-vue Exemptions (rôle / salon).
      { type: "button", customId: Id.EXEMPT_OPEN, label: t("automod.exemptOpen"), style: "primary" },
      {
        type: "select",
        customId: Id.ENFORCE_SELECT,
        placeholder: t("automod.enforcement"),
        options: [
          { label: t("automod.enforcementNone"), value: "none" },
          { label: t("automod.enforcementWarn"), value: "warn" },
          { label: t("automod.enforcementTimeout"), value: "timeout" },
        ],
      },
      { type: "button", customId: Id.BACK, label: t("automod.back"), style: "secondary" },
    ],
  };
}

/**
 * P7 — sous-vue « Exemptions ».
 *
 * Composants NATIFS uniquement (role-select / channel-select multi) — aucun
 * modal texte, aucune saisie manuelle de snowflakes. Budget Discord : 2 rows
 * de sélecteurs + 1 row de 3 boutons = 3 rows (max 5).
 *
 *  - role-select   : maxValues = EXEMPT_MAX_IDS (10), minValues 1 ;
 *  - channel-select : channelTypes texte (0) + annonces (5) — catégories et
 *    threads exclus par le transport lui-même — maxValues 10 ;
 *  - resets distincts rôles / salons + retour au panneau AutoMod.
 *
 * La sélection courante n'est PAS pré-remplie dans le select (limitation
 * Discord : un role/channel select n'a pas de valeurs par défaut) : à chaque
 * envoi la sélection remplace la liste existante après validation/dedup/merge
 * côté serveur (voir configureAutoMod). Les IDs obsolètes se nettoient via
 * les boutons Reset.
 */
function autoModExemptView({ t, config }) {
  const roles = Array.isArray(config.automod_exempt_roles) ? config.automod_exempt_roles.length : 0;
  const channels = Array.isArray(config.automod_exempt_channels) ? config.automod_exempt_channels.length : 0;
  return {
    title: t("automod.title"),
    content: t("automod.exemptHelp"),
    components: [
      {
        type: "role-select",
        customId: Id.EXEMPT_ROLES_SELECT,
        placeholder: `${t("automod.exemptRoles")} (${roles}/${AutoModExemptLimits.MAX_IDS})`,
        minValues: 1,
        maxValues: AutoModExemptLimits.MAX_IDS,
      },
      {
        type: "channel-select",
        customId: Id.EXEMPT_CHANNELS_SELECT,
        placeholder: `${t("automod.exemptChannels")} (${channels}/${AutoModExemptLimits.MAX_IDS})`,
        channelTypes: [...AutoModExemptLimits.CHANNEL_TYPES],
        minValues: 1,
        maxValues: AutoModExemptLimits.MAX_IDS,
      },
      { type: "button", customId: Id.EXEMPT_RESET_ROLES, label: t("automod.exemptResetRoles"), style: "danger" },
      { type: "button", customId: Id.EXEMPT_RESET_CHANNELS, label: t("automod.exemptResetChannels"), style: "danger" },
      { type: "button", customId: Id.EXEMPT_BACK, label: t("automod.back"), style: "secondary" },
    ],
  };
}

module.exports = { autoModView, autoModExemptView, RULES };
