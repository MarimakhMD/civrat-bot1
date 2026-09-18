"use strict";

const { premiumRequiredView } = require("../../../core/entitlements");
const { WelcomeGoodbyeConfigKey: Key } = require("../configuration/welcomeGoodbyeConstants");
const { welcomeImageView } = require("./welcomeImageView");
const { resolveWelcomeImageEntitlement } = require("../services/welcomeImageEntitlement");
const {
  ACCEPTED_IMAGE_CONTENT_TYPES,
  formatImageSize,
} = require("../services/welcomeImageUploadValidation");

/**
 * Actions de la sous-vue « Image Welcome ».
 *
 * Aucune de ces fonctions ne réimplémente la vérification Premium : elles
 * passent toutes par `resolveWelcomeImageEntitlement`, dont la sémantique est
 * identique à celle de la livraison.
 */

/** Ouvre la sous-vue depuis la vue Welcome principale. */
async function openWelcomeImageView(context) {
  const config = context.config ?? await context.settings.get(context.guildId);
  const entitlement = await resolveWelcomeImageEntitlement({
    guildId: context.guildId,
    entitlementService: context.entitlementService,
  });
  const view = welcomeImageView({ t: context.t, config, entitlement, guildId: context.guildId });
  await context.envelope.transport.update({ view });
  return config;
}

/**
 * « Choisir une image » / « Remplacer ».
 *
 * Une modale Discord ne peut contenir que des champs texte, donc aucun
 * sélecteur de fichier : on indique la commande à utiliser. La limite affichée
 * vient de `interaction.attachmentSizeLimit` (propre au serveur), jamais d'une
 * constante.
 */
async function showWelcomeImageUploadHelp(context) {
  const entitlement = await resolveWelcomeImageEntitlement({
    guildId: context.guildId,
    entitlementService: context.entitlementService,
  });
  if (!entitlement.granted) {
    return context.envelope.transport.reply({
      view: premiumRequiredView(context.t, { decision: entitlement.code }),
      ephemeral: true,
    });
  }

  const limit = Number(context.envelope?.attachmentSizeLimit);
  const hasLimit = Number.isFinite(limit) && limit > 0;
  // Deux messages distincts plutôt qu'un « {{limit}} » non interpolé : si l'API
  // ne fournit pas la limite, on ne montre pas de valeur inventée.
  return context.envelope.transport.reply({
    view: {
      content: context.t(
        hasLimit ? "welcomeGoodbye.welcomeImageUploadPrompt" : "welcomeGoodbye.welcomeImageUploadPromptNoLimit",
        {
          command: "/welcomeimage",
          formats: ACCEPTED_IMAGE_CONTENT_TYPES.map((type) => type.replace("image/", "").toUpperCase()).join(", "),
          limit: hasLimit ? formatImageSize(limit) : "",
        },
      ),
      components: [],
    },
    ephemeral: true,
  });
}

/**
 * Supprime l'image personnalisée.
 *
 * Ordre volontaire : la clé de configuration est remise à `null` AVANT la
 * suppression de l'objet. Si la suppression échoue, il ne reste qu'un objet
 * orphelin inoffensif ; l'inverse laisserait une configuration pointant vers un
 * objet absent.
 *
 * La suppression n'exige pas l'entitlement : une guilde repassée Free doit
 * pouvoir nettoyer son image. Elle ne touche de toute façon que l'objet dérivé
 * de son propre guildId.
 */
async function removeWelcomeImage(context) {
  const config = await context.settings.update(context.guildId, { [Key.WELCOME_IMAGE_KEY]: null });
  const removed = context.imageStore ? await context.imageStore.remove(context.guildId) : false;

  const entitlement = await resolveWelcomeImageEntitlement({
    guildId: context.guildId,
    entitlementService: context.entitlementService,
  });
  const view = welcomeImageView({ t: context.t, config, entitlement, guildId: context.guildId });
  view.content = `${context.t("welcomeGoodbye.welcomeImageRemoved")}\n${view.content}`;
  await context.envelope.transport.update({ view });
  return { config, removed };
}

module.exports = { openWelcomeImageView, showWelcomeImageUploadHelp, removeWelcomeImage };
