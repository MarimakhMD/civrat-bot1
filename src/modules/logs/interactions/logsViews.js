"use strict";

const { LogsComponentId: Id } = require("../configuration/logsConstants");
const { LogsCategory, LogsCategoryChannelKey } = require("../configuration/logsCategories");

// Affiche un salon configuré, ou le libellé « non configuré ».
function channelLabel(t, channelId) {
  return channelId ? `<#${channelId}>` : t("logs.notConfigured");
}

// Vue principale des journaux : état global + liste des 8 catégories avec
// leur salon actuel, relue depuis la configuration persistante (jamais d'état
// en mémoire). Chaque catégorie est configurable via le select de catégorie.
function logsView({ t, config }) {
  const enabled = Boolean(config.logs_enabled);
  const lines = Object.values(LogsCategory).map((category) => {
    const key = LogsCategoryChannelKey[category];
    return `${t(`logs.${category}`)} — ${channelLabel(t, config[key])}`;
  });
  return {
    title: t("logs.title"),
    content: [t(enabled ? "logs.enabled" : "logs.disabled"), "", ...lines].join("\n"),
    components: [
      { type: "button", customId: Id.TOGGLE, label: t(config.logs_enabled ? "logs.disable" : "logs.enable"), style: config.logs_enabled ? "success" : "secondary" },
      { type: "select", customId: Id.CATEGORY, placeholder: t("logs.selectCategory"), options: Object.values(LogsCategory).map((value) => ({ value, label: t(`logs.${value}`) })) },
      { type: "button", customId: Id.PREVIEW, label: t("logs.preview"), style: "primary" },
      { type: "button", customId: Id.HOME, label: t("logs.back"), style: "secondary" },
    ],
  };
}

// Sous-vue d'une catégorie : rappelle le salon actuel, permet d'en choisir un
// autre, de désactiver explicitement (écrit null) et de revenir en arrière.
function channelView({ t, category, config }) {
  const key = LogsCategoryChannelKey[category];
  const channelId = config[key];
  return {
    content: [
      t("logs.selectChannel"),
      `${t(`logs.${category}`)} — ${t("logs.currentChannel")}: ${channelLabel(t, channelId)}`,
    ].join("\n"),
    components: [
      { type: "channel-select", customId: `${Id.CHANNEL_PREFIX}:${category}`, placeholder: t("logs.selectChannel"), channelTypes: [0] },
      { type: "button", customId: `${Id.DISABLE_PREFIX}:${category}`, label: t("logs.disableCategory"), style: "danger" },
      { type: "button", customId: Id.BACK, label: t("logs.back"), style: "secondary" },
    ],
  };
}

module.exports = { logsView, channelView };
