"use strict";

const { EntitlementDecision, premiumRequiredView } = require("../../../core/entitlements");
const { WelcomeGoodbyeComponentId: Id, WelcomeGoodbyeConfigKey: Key } = require("../configuration/welcomeGoodbyeConstants");
const { hasCustomWelcomeImage } = require("../services/welcomeImageResource");

/**
 * Sous-vue dédiée « Image Welcome ».
 *
 * Elle existe parce que la vue Welcome principale occupe déjà EXACTEMENT les 5
 * lignes d'action autorisées par Discord : y ajouter un contrôle ferait échouer
 * le rendu. Tous les boutons tiennent ici sur une seule ligne.
 *
 * Quatre états, tous traduits FR/EN :
 *  - Free (non accordé)            → message Premium existant + Retour
 *  - backend injoignable           → message « indisponible » existant + Retour
 *  - Premium, sans image           → [ Choisir une image ] [ Retour ]
 *  - Premium, avec image           → [ Aperçu ] [ Remplacer ] [ Supprimer ] [ Retour ]
 *
 * « Choisir » et « Remplacer » partagent WELCOME_IMAGE_UPLOAD_HELP : les deux
 * mènent à la même instruction (/welcomeimage), seul le libellé change.
 * OPEN_WELCOME_IMAGE sert uniquement à entrer dans cette sous-vue.
 *
 * Aucun bouton d'écriture n'est proposé quand l'entitlement n'est pas accordé :
 * l'interface n'offre même pas le moyen de tenter un contournement.
 */
function button(customId, label, style) {
  return { type: "button", customId, label, style };
}

function backRow(t) {
  return [button(Id.WELCOME_IMAGE_HOME, t("welcomeGoodbye.back"), "secondary")];
}

function welcomeImageView({ t, config, entitlement = null, guildId = null }) {
  const granted = entitlement?.granted === true;

  // Backend injoignable : on ne propose aucune écriture, on explique.
  if (entitlement && entitlement.ok === false) {
    const refusal = premiumRequiredView(t, { decision: entitlement.code || EntitlementDecision.UNAVAILABLE });
    return { title: refusal.title, content: refusal.content, components: backRow(t) };
  }

  // Guilde Free : message Premium existant, aucune action possible.
  if (!granted) {
    const refusal = premiumRequiredView(t, { decision: entitlement?.code || EntitlementDecision.PREMIUM_REQUIRED });
    return { title: refusal.title, content: refusal.content, components: backRow(t) };
  }

  const hasImage = hasCustomWelcomeImage(config, guildId);
  const imageEnabled = config?.[Key.WELCOME_IMAGE_ENABLED] === true;

  const lines = [
    hasImage
      ? t("welcomeGoodbye.welcomeImageActive")
      : t("welcomeGoodbye.welcomeImageNone"),
    // Le toggle reste le prérequis : une image stockée mais toggle éteint n'est
    // pas utilisée. On le dit explicitement plutôt que de laisser deviner.
    imageEnabled ? null : t("welcomeGoodbye.welcomeImageToggleOffWarning"),
  ].filter(Boolean);

  const components = hasImage
    ? [
      button(Id.PREVIEW_WELCOME_IMAGE, t("welcomeGoodbye.welcomeImagePreview"), "primary"),
      button(Id.WELCOME_IMAGE_UPLOAD_HELP, t("welcomeGoodbye.welcomeImageReplace"), "secondary"),
      button(Id.REMOVE_WELCOME_IMAGE, t("welcomeGoodbye.welcomeImageRemove"), "danger"),
      button(Id.WELCOME_IMAGE_HOME, t("welcomeGoodbye.back"), "secondary"),
    ]
    : [
      button(Id.WELCOME_IMAGE_UPLOAD_HELP, t("welcomeGoodbye.welcomeImageChoose"), "primary"),
      button(Id.WELCOME_IMAGE_HOME, t("welcomeGoodbye.back"), "secondary"),
    ];

  return {
    title: t("welcomeGoodbye.welcomeImageTitle"),
    content: lines.join("\n"),
    components,
  };
}

module.exports = { welcomeImageView };
