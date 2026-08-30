"use strict";

const guildConfigService = require("../../../services/guildConfig");
const { getEntitlementService } = require("../../../runtime/getEntitlementService");
const { I18nService } = require("../../../core/i18n");
const { TicketConfigService } = require("../services/TicketConfigService");
const { TicketPremiumConfigResolver } = require("../services/TicketPremiumConfigResolver");
const ticketEn = require("../translations/en.json");
const ticketFr = require("../translations/fr.json");

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
        entitlementService: getEntitlementService(),
      }),
      // P17 : traducteur i18n du module Tickets — même convention que le
      // runtime /settings (I18nService + dictionnaires du module). La locale
      // vient de config.language ; valeur inconnue => FR par défaut
      // (resolveGuildLocale). Plus aucune clé brute dans le panneau Free.
      i18n: new I18nService({ dictionaries: { en: ticketEn, fr: ticketFr } }),
    });
  }
  return runtime;
}
module.exports = { getTicketPanelRuntime };
