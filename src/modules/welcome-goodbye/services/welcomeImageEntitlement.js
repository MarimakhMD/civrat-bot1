"use strict";

const { EntitlementDecision, EntitlementFeature } = require("../../../core/entitlements");

/**
 * Décision d'entitlement WELCOME_IMAGE, normalisée.
 *
 * Sémantique IDENTIQUE à `WelcomeDeliveryService.#resolveCardEntitlement` :
 *  - service absent            → UNAVAILABLE (fail-closed)
 *  - exception du backend      → UNAVAILABLE (fail-closed)
 *  - granted strict            → GRANTED
 *  - sinon                     → PREMIUM_REQUIRED
 *
 * Centraliser cette résolution évite qu'une interface d'administration et la
 * livraison divergent sur ce qui constitue un droit accordé.
 */
async function resolveWelcomeImageEntitlement({ guildId, entitlementService = null } = {}) {
  if (!entitlementService) {
    return { ok: false, granted: false, code: EntitlementDecision.UNAVAILABLE };
  }
  try {
    const decision = await entitlementService.requireFeature({
      guildId,
      feature: EntitlementFeature.WELCOME_IMAGE,
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

module.exports = { resolveWelcomeImageEntitlement };
