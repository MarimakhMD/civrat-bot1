"use strict";

const EntitlementFeature = Object.freeze({
  WELCOME_IMAGE: "WELCOME_IMAGE",
  TICKET_PREMIUM: "TICKET_PREMIUM",
  // P-CAPT L3 — niveaux HIGH/RAID et challenges CAPTCHA.
  CAPTCHA_PREMIUM: "CAPTCHA_PREMIUM",
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
