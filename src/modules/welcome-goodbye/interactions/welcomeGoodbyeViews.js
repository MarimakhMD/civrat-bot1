"use strict";
const { WelcomeGoodbyeComponentId: Id, CIVRAT_GUILD_ID, CIVRAT_TEMPLATE_ID } = require("../configuration/welcomeGoodbyeConstants");
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

// Sous-vue Welcome : 13 contrôles + retour à la section (5 lignes max).
//
// Placement du toggle Image Welcome : le transport regroupe les boutons
// consécutifs par lignes de 5 et isole chaque select dans sa ligne. Avec 10
// boutons puis 2 selects, la vue occupait déjà exactement 5 lignes. Le toggle
// est donc placé APRÈS les deux selects, où il partage la dernière ligne avec
// « Retour » — ajouter un 11e bouton au bloc initial aurait produit 6 lignes et
// fait échouer le rendu.
function welcomeView({ t, config, guildId = null }) {
  const templateOptions = [
    { value: "template-1", label: t("welcomeGoodbye.templateBlue") },
    { value: "template-2", label: t("welcomeGoodbye.templateViolet") },
    { value: "template-3", label: t("welcomeGoodbye.templateRed") },
  ];
  // Template officiel CIVRAT : l'option n'apparaît que pour le serveur réservé
  // (guildId exact). Aucun autre serveur ne voit cette entrée.
  if (String(guildId) === CIVRAT_GUILD_ID) templateOptions.push({ value: CIVRAT_TEMPLATE_ID, label: t("welcomeGoodbye.templateCivrat") });
  return {
    title: t(Key.TITLE),
    content: `${t("welcomeGoodbye.welcomeSection")}\n${t("welcomeGoodbye.welcomeImagePremiumNotice")}`,
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
      { type: "select", customId: Id.TEMPLATE_SELECT, placeholder: t("welcomeGoodbye.selectTemplate"), options: templateOptions },
      // Contrôle UI de `welcome_image_enabled` : libellé selon l'état RÉEL
      // persisté, comparaison stricte à `true` (fail-closed, même règle que la
      // livraison et l'aperçu). La vérification Premium reste appliquée à
      // l'activation par toggleWelcomeImage — le bouton ne la contourne jamais.
      button(Id.TOGGLE_WELCOME_IMAGE, t(config.welcome_image_enabled === true ? "welcomeGoodbye.disableWelcomeImage" : "welcomeGoodbye.enableWelcomeImage"), config.welcome_image_enabled === true ? "success" : "secondary"),
      // Entrée de la sous-vue « Image Welcome » (Premium). Placée dans la
      // DERNIÈRE ligne, avec le toggle et « Retour » : la vue Welcome occupe
      // déjà exactement 5 lignes d'action, et un bouton de plus dans le bloc
      // initial en produirait une sixième — ce qui fait échouer le rendu.
      button(Id.OPEN_WELCOME_IMAGE, t("welcomeGoodbye.welcomeImageMenu"), "primary"),
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
