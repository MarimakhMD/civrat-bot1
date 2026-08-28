"use strict";

const { EntitlementService } = require("../core/entitlements");
const { SupabaseEntitlementRepository } = require("../adapters/supabase");

let service = null;

/**
 * Process-wide EntitlementService. The repository remains the existing
 * guild_entitlements Supabase adapter; no cache or secondary source of truth is
 * introduced. With no Supabase client, requireFeature reports UNAVAILABLE.
 */
function getEntitlementService() {
  if (!service) {
    const { supabase } = require("../config/database");
    service = new EntitlementService({
      repository: new SupabaseEntitlementRepository({ supabase }),
    });
  }
  return service;
}

module.exports = { getEntitlementService };
