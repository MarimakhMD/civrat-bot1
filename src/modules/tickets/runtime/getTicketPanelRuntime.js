"use strict";

const guildConfigService = require("../../../services/guildConfig");
const { supabase } = require("../../../config/database");
const { EntitlementService } = require("../../../core/entitlements");
const { SupabaseEntitlementRepository } = require("../../../adapters/supabase");
const { TicketConfigService } = require("../services/TicketConfigService");
const { TicketPremiumConfigResolver } = require("../services/TicketPremiumConfigResolver");

// Runtime partagé du panneau Tickets (Phase 10.2) : même injection que la
// composition /settings — config legacy guild_configs + entitlement Supabase +
// resolver Premium en couches. Singleton paresseux (pattern getLogsRuntime).
// Le transport Discord n'en fait PAS partie : il crée par interaction car il
// dépend de la guilde. Sans Supabase configuré (offline), le resolver est
// fail-closed : le panneau reste au rendu Free historique.
let runtime = null;
function getTicketPanelRuntime() {
  if (!runtime) {
    runtime = Object.freeze({
      configService: new TicketConfigService({
        guildConfigResolver: {
          get: guildConfigService.getGuildConfig,
          update: guildConfigService.updateGuildConfig,
        },
      }),
      premiumConfigResolver: new TicketPremiumConfigResolver({
        entitlementService: new EntitlementService({ repository: new SupabaseEntitlementRepository({ supabase }) }),
      }),
    });
  }
  return runtime;
}
module.exports = { getTicketPanelRuntime };
