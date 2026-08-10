"use strict";
const { ConfigurationError } = require("../../../core/errors");
function normalizeWelcomeDeliveryError(error, context = {}) {
  const message = String(error?.message || "");
  const reason = /channel_unavailable|Missing Access|Missing Permissions/i.test(message)
    ? "channel_unavailable"
    : "delivery_failed";
  return new ConfigurationError("CONFIGURATION_UNAVAILABLE", { ...context, reason }, error);
}
module.exports = { normalizeWelcomeDeliveryError };
