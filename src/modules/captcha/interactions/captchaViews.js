"use strict";

const {
  CaptchaComponentId: Id,
  resolveCaptchaSessionSettings,
  CAPTCHA_DURATION_PRESETS,
  CAPTCHA_LIMITS_PRESETS,
  CAPTCHA_LEVEL_LIST,
  CAPTCHA_MODE_LIST,
  CAPTCHA_CHALLENGE_TYPE_LIST,
  CaptchaLevel,
  CaptchaMode,
  CaptchaChallengeType,
  resolveCaptchaLevel,
  resolveCaptchaMode,
  resolveCaptchaChallengeType,
  resolveCaptchaRequestedPlan,
  buildCaptchaChallengeCustomId,
} = require("../configuration/captchaConstants");

/** Libellés localisés par valeur (jamais de valeur brute affichée). */
const LEVEL_LABEL_KEYS = Object.freeze({
  [CaptchaLevel.LOW]: "captcha.levelLow",
  [CaptchaLevel.NORMAL]: "captcha.levelNormal",
  [CaptchaLevel.HIGH]: "captcha.levelHigh",
  [CaptchaLevel.RAID]: "captcha.levelRaid",
});
const MODE_LABEL_KEYS = Object.freeze({
  [CaptchaMode.BUTTON]: "captcha.modeButton",
  [CaptchaMode.CHALLENGE]: "captcha.modeChallenge",
});
const CHALLENGE_LABEL_KEYS = Object.freeze({
  [CaptchaChallengeType.CHOICE]: "captcha.challengeChoice",
  [CaptchaChallengeType.ORDER]: "captcha.challengeOrder",
  [CaptchaChallengeType.PICK]: "captcha.challengePick",
});
/** Marqueur d'expérience Premium, ajouté au libellé du niveau. */
const PREMIUM_MARK = "⭐";

// Vue de la section Captcha dans /settings : état réel (salon + rôles sous
// forme de mentions), niveau de sécurité, toggle, sélecteurs et navigation.
// Contrainte Discord : 4 selects (4 lignes) + 1 ligne de boutons = 5 lignes.
function captchaView({ t, config, granted = null }) {
  const level = resolveCaptchaLevel(config);
  const requested = resolveCaptchaRequestedPlan(config);
  const lines = [
    t(config.captcha_enabled ? "captcha.enabled" : "captcha.disabled"),
    config.captcha_channel_id
      ? `${t("captcha.channel")} : <#${config.captcha_channel_id}>`
      : t("captcha.channelMissing"),
    config.captcha_role_id
      ? `${t("captcha.role")} : <@&${config.captcha_role_id}>`
      : t("captcha.roleMissing"),
    config.captcha_unverified_role_id
      ? `${t("captcha.unverifiedRole")} : <@&${config.captcha_unverified_role_id}>`
      : t("captcha.unverifiedRoleMissing"),
    t("captcha.levelLabel", {
      level: `${t(LEVEL_LABEL_KEYS[level])}${requested.premium ? ` ${PREMIUM_MARK}` : ""}`,
    }),
  ];
  if (requested.premium && granted === false) lines.push(t("captcha.premiumNotice"));

  return {
    title: t("captcha.title"),
    content: lines.join("\n"),
    components: [
      { type: "channel-select", customId: Id.CHANNEL, placeholder: t("captcha.channel"), channelTypes: [0] },
      { type: "role-select", customId: Id.ROLE, placeholder: t("captcha.role") },
      { type: "role-select", customId: Id.UNVERIFIED_ROLE, placeholder: t("captcha.unverifiedRole") },
      {
        type: "string-select",
        customId: Id.LEVEL,
        placeholder: t("captcha.level"),
        options: CAPTCHA_LEVEL_LIST.map((value) => ({ label: t(LEVEL_LABEL_KEYS[value]), value })),
      },
      { type: "button", customId: Id.TOGGLE, label: t(config.captcha_enabled ? "captcha.disable" : "captcha.enable"), style: config.captcha_enabled ? "success" : "secondary" },
      { type: "button", customId: Id.ADVANCED, label: t("captcha.advanced"), style: "primary" },
      { type: "button", customId: Id.PREVIEW, label: t("captcha.preview"), style: "primary" },
      { type: "button", customId: Id.RESET, label: t("captcha.reset"), style: "danger" },
      { type: "button", customId: Id.BACK, label: t("captcha.back"), style: "secondary" },
    ],
  };
}

/**
 * P-CAPT L1/L3 — sous-vue « Avancé » : expiration, tentatives/cooldown (L1),
 * mode et type de challenge (L3), plus le force-existing des membres existants.
 * Contrainte Discord : 4 selects (4 lignes) + 1 ligne de boutons = 5 lignes.
 * Le retour réutilise la route SECTION existante (aucune route supplémentaire).
 */
function captchaAdvancedView({ t, config, granted = null }) {
  const settings = resolveCaptchaSessionSettings(config);
  const mode = resolveCaptchaMode(config);
  const requested = resolveCaptchaRequestedPlan(config);
  const challengeType = resolveCaptchaChallengeType(config);
  const lines = [
    t("captcha.durationLabel", { minutes: Math.round(settings.expiryMs / 60000) }),
    t("captcha.limitsLabel", { attempts: settings.maxAttempts, cooldown: Math.round(settings.cooldownMs / 1000) }),
    t("captcha.modeLabel", { mode: `${t(MODE_LABEL_KEYS[mode])}${requested.premium ? ` ${PREMIUM_MARK}` : ""}` }),
    mode === CaptchaMode.CHALLENGE
      ? t("captcha.challengeLabel", { challenge: t(CHALLENGE_LABEL_KEYS[challengeType]) })
      : t("captcha.challengeInactive"),
  ];
  if (requested.premium && granted === false) lines.push(t("captcha.premiumNotice"));

  return {
    title: t("captcha.title"),
    content: lines.join("\n"),
    components: [
      { type: "string-select", customId: Id.DURATION, placeholder: t("captcha.duration"), options: CAPTCHA_DURATION_PRESETS.map((minutes) => ({ label: t("captcha.durationOption", { count: minutes }), value: String(minutes) })) },
      { type: "string-select", customId: Id.LIMITS, placeholder: t("captcha.limits"), options: CAPTCHA_LIMITS_PRESETS.map((preset) => ({ label: t("captcha.limitsOption", { attempts: preset.attempts, cooldown: preset.cooldownSeconds }), value: `${preset.attempts}/${preset.cooldownSeconds}` })) },
      {
        type: "string-select",
        customId: Id.MODE,
        placeholder: t("captcha.mode"),
        options: CAPTCHA_MODE_LIST.map((value) => ({ label: t(MODE_LABEL_KEYS[value]), value })),
      },
      {
        type: "string-select",
        customId: Id.CHALLENGE,
        placeholder: t("captcha.challenge"),
        options: CAPTCHA_CHALLENGE_TYPE_LIST.map((value) => ({ label: t(CHALLENGE_LABEL_KEYS[value]), value })),
      },
      { type: "button", customId: Id.FORCE_EXISTING, label: t("captcha.forceExisting"), style: "secondary" },
      { type: "button", customId: Id.SECTION, label: t("captcha.back"), style: "secondary" },
    ],
  };
}

/**
 * P-CAPT L3 — vue éphémère du challenge : uniquement le prompt localisé et les
 * options ; la réponse correcte reste côté serveur (jamais dans le customId).
 */
function captchaChallengeView({ t, challenge }) {
  const promptVars = { ...(challenge.promptVars || {}) };
  if (promptVars.condition) promptVars.condition = t(promptVars.condition);
  const lines = [t(challenge.promptKey, promptVars)];
  if (challenge.type === CaptchaChallengeType.ORDER) {
    lines.push(t("captcha.challengeProgress", { current: challenge.progress, total: challenge.stepCount }));
  }
  return {
    title: t("captcha.challengeTitle"),
    content: lines.join("\n"),
    components: challenge.options.map((option) => ({
      type: "button",
      customId: buildCaptchaChallengeCustomId({ type: challenge.type, challengeId: challenge.id, value: option.value }),
      label: option.label,
      style: "secondary",
    })),
  };
}

module.exports = { captchaView, captchaAdvancedView, captchaChallengeView, LEVEL_LABEL_KEYS, MODE_LABEL_KEYS, CHALLENGE_LABEL_KEYS };
