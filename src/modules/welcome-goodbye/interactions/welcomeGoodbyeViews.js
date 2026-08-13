"use strict";
const { WelcomeGoodbyeComponentId: Id } = require("../configuration/welcomeGoodbyeConstants");
const { Key } = require("../translations/translationKeys");

// Phase 3.1 — la section Welcome & Goodbye est éclatée en sous-vues : Discord
// limite chaque message à 5 lignes de composants. Toutes les fonctionnalités
// existantes sont conservées ; seule la navigation change. L'ordre de
// déclaration des composants est significatif : le transport regroupe les
// boutons consécutifs par lignes de 5 et isole chaque select dans sa ligne.

function button(customId, label, style) { return { type: "button", customId, label, style }; }

// Vue d'entrée de la section : aiguillage vers les sous-vues Welcome/Goodbye.
function settingsView({ t }) {
  return {
    title: t(Key.TITLE),
    content: t(Key.SECTION),
    components: [
      button(Id.OPEN_WELCOME, t("welcomeGoodbye.configureWelcome"), "primary"),
      button(Id.OPEN_GOODBYE, t("welcomeGoodbye.configureGoodbye"), "primary"),
      button(Id.BACK, t("welcomeGoodbye.back"), "secondary"),
    ],
  };
}

// Sous-vue Welcome : 12 contrôles + retour à la section (5 lignes max).
function welcomeView({ t, config }) {
  return {
    title: t(Key.TITLE),
    content: t("welcomeGoodbye.welcomeSection"),
    components: [
      button(Id.TOGGLE_WELCOME, t(config.welcome_enabled ? "welcomeGoodbye.disableWelcome" : "welcomeGoodbye.enableWelcome"), config.welcome_enabled ? "success" : "secondary"),
      button(Id.WELCOME_MESSAGE, t("welcomeGoodbye.welcomeMessage"), "secondary"),
      button(Id.TOGGLE_WELCOME_EMBED, t(config.welcome_embed_enabled ? "welcomeGoodbye.disableEmbed" : "welcomeGoodbye.enableEmbed"), config.welcome_embed_enabled ? "success" : "secondary"),
      button(Id.WELCOME_EMBED_COLOR, t("welcomeGoodbye.embedColor"), "secondary"),
      button(Id.PREVIEW_WELCOME_EMBED, t("welcomeGoodbye.previewEmbed"), "primary"),
      button(Id.TOGGLE_WELCOME_DM, t(config.welcome_dm_enabled ? "welcomeGoodbye.disableDm" : "welcomeGoodbye.enableDm"), config.welcome_dm_enabled ? "success" : "secondary"),
      button(Id.WELCOME_DM_MESSAGE, t("welcomeGoodbye.dmMessage"), "secondary"),
      button(Id.TEST_WELCOME_DM, t("welcomeGoodbye.testDm"), "primary"),
      button(Id.PREVIEW_WELCOME_IMAGE, t("welcomeGoodbye.previewWelcomeImage"), "primary"),
      button(Id.TEST_WELCOME, t("welcomeGoodbye.testWelcome"), "primary"),
      { type: "channel-select", customId: Id.WELCOME_CHANNEL, placeholder: t(Key.WELCOME_CHANNEL), channelTypes: [0] },
      { type: "select", customId: Id.TEMPLATE_SELECT, placeholder: t("welcomeGoodbye.selectTemplate"), options: [{ value: "template-1", label: t("welcomeGoodbye.templateBlue") }, { value: "template-2", label: t("welcomeGoodbye.templateViolet") }, { value: "template-3", label: t("welcomeGoodbye.templateRed") }] },
      button(Id.SECTION, t("welcomeGoodbye.back"), "secondary"),
    ],
  };
}

// Sous-vue Goodbye : 9 contrôles + retour à la section (5 lignes max).
function goodbyeView({ t, config }) {
  return {
    title: t(Key.TITLE),
    content: t("welcomeGoodbye.goodbyeSection"),
    components: [
      button(Id.TOGGLE_GOODBYE, t(config.goodbye_enabled ? "welcomeGoodbye.disableGoodbye" : "welcomeGoodbye.enableGoodbye"), config.goodbye_enabled ? "success" : "secondary"),
      button(Id.GOODBYE_MESSAGE, t("welcomeGoodbye.goodbyeMessage"), "secondary"),
      button(Id.TOGGLE_GOODBYE_EMBED, t(config.goodbye_embed_enabled ? "welcomeGoodbye.disableGoodbyeEmbed" : "welcomeGoodbye.enableGoodbyeEmbed"), config.goodbye_embed_enabled ? "success" : "secondary"),
      button(Id.GOODBYE_EMBED_COLOR, t("welcomeGoodbye.goodbyeEmbedColor"), "secondary"),
      button(Id.PREVIEW_GOODBYE_EMBED, t("welcomeGoodbye.previewGoodbyeEmbed"), "primary"),
      { type: "channel-select", customId: Id.GOODBYE_CHANNEL_SELECT, placeholder: t("welcomeGoodbye.goodbyeChannel"), channelTypes: [0] },
      button(Id.SAME_CHANNEL, t("welcomeGoodbye.sameChannel"), "secondary"),
      button(Id.PREVIEW_GOODBYE, t("welcomeGoodbye.previewGoodbye"), "primary"),
      button(Id.TEST_GOODBYE, t("welcomeGoodbye.testGoodbye"), "primary"),
      button(Id.SECTION, t("welcomeGoodbye.back"), "secondary"),
    ],
  };
}

module.exports = { settingsView, welcomeView, goodbyeView };
