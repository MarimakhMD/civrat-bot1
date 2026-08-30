"use strict";

const {
  EntitlementService,
  PremiumMutationPolicy,
} = require("../core/entitlements");
const { SupabaseEntitlementRepository } = require("../adapters/supabase");

async function authorizeTechnicalPremiumOwner({ actorId }) {
  try {
    // Lazy require avoids a composition cycle while ensuring callers cannot
    // replace the production verifier through getEntitlementService options.
    const { getOwnerPanelRuntime } = require("../modules/owner-panel/runtime/getOwnerPanelRuntime");
    const runtime = getOwnerPanelRuntime();
    return runtime.panel.authorizePremiumMutation({
      actorId,
      identityService: runtime.identity,
    });
  } catch {
    return false;
  }
}

let service = null;
const mutationPolicy = new PremiumMutationPolicy({
  ownerAuthorization: authorizeTechnicalPremiumOwner,
});

/**
 * Process-wide EntitlementService. Its repository and immutable Premium
 * mutation policy are singletons too: no cache, configurator, or secondary
 * Premium authority is introduced.
 */
function getEntitlementService() {
  if (!service) {
    const { supabase } = require("../config/database");
    service = new EntitlementService({
      repository: new SupabaseEntitlementRepository({ supabase, mutationPolicy }),
      mutationPolicy,
    });
  }
  return service;
}

module.exports = { getEntitlementService };
