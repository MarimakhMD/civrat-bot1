"use strict";

const EntitlementDecision = Object.freeze({
  GRANTED: "ENTITLEMENT_GRANTED",
  PREMIUM_REQUIRED: "PREMIUM_REQUIRED",
  UNAVAILABLE: "ENTITLEMENT_UNAVAILABLE",
});

module.exports = { EntitlementDecision };
