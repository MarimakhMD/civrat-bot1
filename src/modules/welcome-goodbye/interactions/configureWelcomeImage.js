"use strict";

const { EntitlementDecision, EntitlementFeature, premiumRequiredView } = require("../../../core/entitlements");
const { WelcomeGoodbyeConfigKey: Key } = require("../configuration/welcomeGoodbyeConstants");
const { updateWelcomeSettings } = require("./updateWelcomeSettings");

/**
 * Contrôle UI du toggle `welcome_image_enabled`.
 *
 * Cette fonction n'ajoute AUCUNE logique Premium : elle réutilise exactement la
 * gate déjà appliquée par le bouton « Aperçu Image Welcome » et par
 * `WelcomeDeliveryService`. Elle ne fait que l'exposer dans le menu.
 *
 * Règles :
 *  - lecture STRICTE (`=== true`) : `undefined`, `null` ou toute valeur non
 *    booléenne comptent comme désactivé (fail-closed), comme partout ailleurs ;
 *  - ACTIVER exige l'entitlement WELCOME_IMAGE : sans entitlement accordé, rien
 *    n'est écrit et la vue Premium existante est affichée. Aucune écriture ne
 *    peut donc contourner la vérification Premium ;
 *  - DÉSACTIVER n'exige jamais d'entitlement : un administrateur doit toujours
 *    pouvoir éteindre la fonctionnalité, y compris si le backend Premium est
 *    devenu injoignable ;
 *  - un `entitlementService` absent est traité comme UNAVAILABLE (fail-closed),
 *    exactement comme dans register.js.
 */
async function toggleWelcomeImage(context) {
  const config = await context.settings.get(context.guildId);
  const enabled = config?.[Key.WELCOME_IMAGE_ENABLED] === true;

  if (!enabled) {
    const decision = context.entitlementService
      ? await context.entitlementService.requireFeature({
        guildId: context.guildId,
        feature: EntitlementFeature.WELCOME_IMAGE,
      })
      : { ok: false, granted: false, code: EntitlementDecision.UNAVAILABLE };

    if (!decision.granted) {
      return context.envelope.transport.reply({
        view: premiumRequiredView(context.t, { decision: decision.code }),
        ephemeral: true,
      });
    }
  }

  return updateWelcomeSettings(context, { [Key.WELCOME_IMAGE_ENABLED]: !enabled });
}

module.exports = { toggleWelcomeImage };
