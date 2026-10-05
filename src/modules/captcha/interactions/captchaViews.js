"use strict";

const { CaptchaComponentId: Id, resolveCaptchaSessionSettings, CAPTCHA_DURATION_PRESETS, CAPTCHA_LIMITS_PRESETS } = require("../configuration/captchaConstants");

// Vue de la section Captcha dans /settings : état réel (salon + rôle sous forme
// de mentions), toggle, sélecteurs salon/rôle, aperçu, réinitialisation, retour.
function captchaView({ t, config }) {
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
  ];

  return {
    title: t("captcha.title"),
    content: lines.join("\n"),
    components: [
      { type: "button", customId: Id.TOGGLE, label: t(config.captcha_enabled ? "captcha.disable" : "captcha.enable"), style: config.captcha_enabled ? "success" : "secondary" },
      { type: "channel-select", customId: Id.CHANNEL, placeholder: t("captcha.channel"), channelTypes: [0] },
      { type: "role-select", customId: Id.ROLE, placeholder: t("captcha.role") },
      { type: "role-select", customId: Id.UNVERIFIED_ROLE, placeholder: t("captcha.unverifiedRole") },
      { type: "button", customId: Id.ADVANCED, label: t("captcha.advanced"), style: "primary" },
      { type: "button", customId: Id.FORCE_EXISTING, label: t("captcha.forceExisting"), style: "secondary" },
      { type: "button", customId: Id.PREVIEW, label: t("captcha.preview"), style: "primary" },
      { type: "button", customId: Id.RESET, label: t("captcha.reset"), style: "danger" },
      { type: "button", customId: Id.BACK, label: t("captcha.back"), style: "secondary" },
    ],
  };
}

/**
 * P-CAPT L1 — sous-vue « Avancé » : expiration, tentatives et cooldown.
 * Le retour réutilise la route SECTION existante (aucune route supplémentaire).
 */
function captchaAdvancedView({ t, config }) {
  const settings = resolveCaptchaSessionSettings(config);
  const lines = [
    t("captcha.durationLabel", { minutes: Math.round(settings.expiryMs / 60000) }),
    t("captcha.limitsLabel", { attempts: settings.maxAttempts, cooldown: Math.round(settings.cooldownMs / 1000) }),
  ];
  return {
    title: t("captcha.title"),
    content: lines.join("\n"),
    components: [
      { type: "string-select", customId: Id.DURATION, placeholder: t("captcha.duration"), options: CAPTCHA_DURATION_PRESETS.map((minutes) => ({ label: t("captcha.durationOption", { count: minutes }), value: String(minutes) })) },
      { type: "string-select", customId: Id.LIMITS, placeholder: t("captcha.limits"), options: CAPTCHA_LIMITS_PRESETS.map((preset) => ({ label: t("captcha.limitsOption", { attempts: preset.attempts, cooldown: preset.cooldownSeconds }), value: `${preset.attempts}/${preset.cooldownSeconds}` })) },
      { type: "button", customId: Id.SECTION, label: t("captcha.back"), style: "secondary" },
    ],
  };
}

module.exports = { captchaView, captchaAdvancedView };
