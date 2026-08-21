"use strict";

const { CaptchaComponentId: Id } = require("../configuration/captchaConstants");

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
  ];

  return {
    title: t("captcha.title"),
    content: lines.join("\n"),
    components: [
      { type: "button", customId: Id.TOGGLE, label: t(config.captcha_enabled ? "captcha.disable" : "captcha.enable"), style: config.captcha_enabled ? "success" : "secondary" },
      { type: "channel-select", customId: Id.CHANNEL, placeholder: t("captcha.channel"), channelTypes: [0] },
      { type: "role-select", customId: Id.ROLE, placeholder: t("captcha.role") },
      { type: "button", customId: Id.PREVIEW, label: t("captcha.preview"), style: "primary" },
      { type: "button", customId: Id.RESET, label: t("captcha.reset"), style: "danger" },
      { type: "button", customId: Id.BACK, label: t("captcha.back"), style: "secondary" },
    ],
  };
}

module.exports = { captchaView };
