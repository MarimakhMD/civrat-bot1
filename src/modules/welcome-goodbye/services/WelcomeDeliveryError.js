"use strict";
const { ConfigurationError } = require("../../../core/errors");

/**
 * Normalise un échec de livraison Welcome/Goodbye.
 *
 * PHASE 2 (B8) — le transport Welcome porte désormais un motif précis dans
 * `error.reason` (`CHANNEL_MISSING`, `CHANNEL_NOT_FOUND`, `MISSING_PERMISSIONS`,
 * `USER_UNAVAILABLE`). Ce motif a priorité : « salon supprimé » et « bot sans
 * permission » n'étaient auparavant pas distinguables.
 *
 * Le repli historique par expression régulière est conservé pour tout appelant
 * qui ne fournit pas `reason` : le contrat existant (`channel_unavailable`) est
 * inchangé.
 */
function normalizeWelcomeDeliveryError(error, context = {}) {
  const message = String(error?.message || "");
  const explicit = error && typeof error.reason === "string" && error.reason.length > 0 ? error.reason : null;
  const reason = explicit
    || (/channel_unavailable|Missing Access|Missing Permissions/i.test(message)
      ? "channel_unavailable"
      : "delivery_failed");
  return new ConfigurationError("CONFIGURATION_UNAVAILABLE", { ...context, reason }, error);
}
module.exports = { normalizeWelcomeDeliveryError };
