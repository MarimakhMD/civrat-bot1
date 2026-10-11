"use strict";

const { EntitlementDecision, EntitlementFeature } = require("../../../core/entitlements");

/**
 * P-CAPT L3 — décision d'entitlement CAPTCHA_PREMIUM, normalisée.
 *
 * Sémantique IDENTIQUE à `resolveWelcomeImageEntitlement` (même cœur
 * d'entitlements, aucun système Premium parallèle) :
 *  • service absent            → UNAVAILABLE (fail-closed : refus) ;
 *  • exception du backend      → UNAVAILABLE (fail-closed : refus) ;
 *  • granted strict            → GRANTED ;
 *  • sinon                     → PREMIUM_REQUIRED.
 *
 * Un niveau HIGH/RAID ou un mode challenge ne peut donc JAMAIS être servi à un
 * serveur sans droit accordé.
 */
async function resolveCaptchaEntitlement({ guildId, entitlementService = null } = {}) {
  if (!entitlementService) {
    return { ok: false, granted: false, code: EntitlementDecision.UNAVAILABLE };
  }
  try {
    const decision = await entitlementService.requireFeature({
      guildId,
      feature: EntitlementFeature.CAPTCHA_PREMIUM,
    });
    return {
      ok: Boolean(decision?.ok),
      granted: decision?.granted === true,
      code: decision?.code || EntitlementDecision.UNAVAILABLE,
    };
  } catch {
    return { ok: false, granted: false, code: EntitlementDecision.UNAVAILABLE };
  }
}

module.exports = { resolveCaptchaEntitlement };
