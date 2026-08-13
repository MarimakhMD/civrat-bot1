"use strict";

const { EntitlementFeature } = require("../../../core/entitlements");
const { TicketPremiumDefaults } = require("../configuration/ticketPremiumDefaults");
const { isValidTicketPremiumValue } = require("../configuration/ticketPremiumValidation");

// Résolution en couches de la configuration Ticket (Phase 10.1 — fondations) :
//
//   defaults Free (null partout)  ←  overrides Premium, clé par clé,
//   UNIQUEMENT si l'entitlement TICKET_PREMIUM est actif pour la guilde.
//
// Garanties :
//  - aucune fuite Premium vers Free : sans entitlement actif, les clés Premium
//    stockées en base ne sont jamais exposées ;
//  - fail-closed : toute erreur de vérification d'entitlement retombe sur les
//    defaults Free (le moteur Ticket Free ne dépend jamais de l'infra Premium) ;
//  - révocation immédiate : l'entitlement est interrogé à chaque résolution,
//    donc sa perte fait instantanément revenir au Free ;
//  - robustesse : une valeur invalide en base est ignorée (fallback Free pour
//    cette clé seule) ; seules les 8 clés déclarées peuvent être exposées.
//
// Ce resolver n'est consommé par aucun rendu à ce stade : les phases 10.2 à
// 10.4 l'injecteront dans le panneau, l'accueil et le nommage.
class TicketPremiumConfigResolver {
  constructor({ entitlementService = null, logger = null }) {
    this.entitlementService = entitlementService;
    this.logger = logger;
  }

  // Fail-closed : toute erreur de vérification d'entitlement = Premium inactif.
  async isActive(guildId) {
    if (!this.entitlementService || !guildId) return false;
    try {
      return await this.entitlementService.hasFeature({ guildId, feature: EntitlementFeature.TICKET_PREMIUM });
    } catch (error) {
      this.logger?.error?.("Ticket Premium entitlement check failed; falling back to Free", { guildId, error: error.message });
      return false;
    }
  }

  async resolve({ guildId, config = {} }) {
    const resolved = { ...TicketPremiumDefaults };
    if (!(await this.isActive(guildId))) return resolved;
    if (!config || typeof config !== "object") return resolved;

    for (const key of Object.keys(resolved)) {
      const value = config[key];
      if (value === undefined || value === null) continue;
      if (isValidTicketPremiumValue(key, value)) resolved[key] = value;
    }
    return resolved;
  }
}

module.exports = { TicketPremiumConfigResolver };
