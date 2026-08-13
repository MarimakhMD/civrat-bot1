"use strict";

const { TicketConfigKey: Key, TicketComponentId: Id } = require("../configuration/ticketConstants");
const { TicketPremiumConfigKey: PKey } = require("../configuration/ticketPremiumConstants");

class TicketPanelService {
  constructor({ configService, premiumConfigResolver = null }) {
    this.configService = configService;
    this.premiumConfigResolver = premiumConfigResolver;
  }

  async build(guildId, t) {
    const config = await this.configService.read(guildId);
    if (!config[Key.ENABLED]) return { ready: false, code: "TICKETS_DISABLED", details: {} };
    if (!config[Key.CATEGORY_ID] || !config[Key.SUPPORT_ROLE_ID]) return { ready: false, code: "TICKET_CONFIG_INCOMPLETE", details: {} };

    // Phase 10.2 — personnalisations Premium du panneau : consommées
    // uniquement quand l'entitlement TICKET_PREMIUM est actif (résolution en
    // couches, fail-closed). Sans resolver injecté (composition Free) ou sans
    // entitlement, le rendu reste strictement le rendu Free historique.
    const premium = this.premiumConfigResolver
      ? await this.premiumConfigResolver.resolve({ guildId, config })
      : null;
    const override = (key) => (premium && premium[key]) || null;

    const view = {
      title: override(PKey.PANEL_TITLE) || t("tickets.panelTitle"),
      content: override(PKey.PANEL_DESCRIPTION) || t("tickets.panelDescription"),
      components: [{ type: "button", customId: Id.CREATE, label: override(PKey.CREATE_BUTTON_LABEL) || t("tickets.create"), style: "primary" }],
    };
    const color = override(PKey.PANEL_COLOR);
    const image = override(PKey.PANEL_IMAGE_URL);
    if (color || image) view.embed = { color, image };
    // P12.2 (B1) : le service ne décide PLUS de la destination. La catégorie
    // (ticket_category_id) est la destination des SALONS de tickets, jamais du
    // panneau — un envoi vers une catégorie échoue toujours (isTextBased=false).
    // La cible est fournie par l'appelant (salon de l'interaction /ticketpanel).
    return { ready: true, view };
  }
}

module.exports = { TicketPanelService };
