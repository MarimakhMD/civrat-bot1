"use strict";

const EntitlementFeature = Object.freeze({
  WELCOME_IMAGE: "WELCOME_IMAGE",
  TICKET_PREMIUM: "TICKET_PREMIUM",
});

const EntitlementFeatureList = Object.freeze(Object.values(EntitlementFeature));

function isEntitlementFeature(feature) {
  return EntitlementFeatureList.includes(feature);
}

module.exports = {
  EntitlementFeature,
  EntitlementFeatureList,
  isEntitlementFeature,
};
