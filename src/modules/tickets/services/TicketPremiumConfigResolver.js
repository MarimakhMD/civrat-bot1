"use strict";

const {
  EntitlementDecision,
  EntitlementFeature,
} = require("../../../core/entitlements");
const { TicketPremiumDefaults } = require("../configuration/ticketPremiumDefaults");
const { isValidTicketPremiumValue } = require("../configuration/ticketPremiumValidation");

/**
 * Layered Ticket configuration resolver.
 *
 * Free execution remains independent from Premium infrastructure: unavailable
 * or missing access resolves to Free defaults. Explicit Premium interactions
 * consume checkAccess() so they can explain the real decision to the user.
 */
class TicketPremiumConfigResolver {
  constructor({ entitlementService = null, logger = null }) {
    this.entitlementService = entitlementService;
    this.logger = logger;
  }

  async checkAccess(guildId) {
    if (!this.entitlementService || !guildId || typeof this.entitlementService.requireFeature !== "function") {
      return { ok: false, granted: false, code: EntitlementDecision.UNAVAILABLE };
    }
    const decision = await this.entitlementService.requireFeature({
      guildId,
      feature: EntitlementFeature.TICKET_PREMIUM,
    });
    if (decision.code === EntitlementDecision.UNAVAILABLE) {
      this.logger?.warn?.("ticket_premium_entitlement_unavailable", { guildId });
    }
    return decision;
  }

  async isActive(guildId) {
    return (await this.checkAccess(guildId)).granted;
  }

  async resolve({ guildId, config = {}, decision = null }) {
    const resolved = { ...TicketPremiumDefaults };
    const access = decision || await this.checkAccess(guildId);
    if (!access.granted || !config || typeof config !== "object") return resolved;

    for (const key of Object.keys(resolved)) {
      const value = config[key];
      if (value === undefined || value === null) continue;
      if (isValidTicketPremiumValue(key, value)) resolved[key] = value;
    }
    return resolved;
  }
}

module.exports = { TicketPremiumConfigResolver };
