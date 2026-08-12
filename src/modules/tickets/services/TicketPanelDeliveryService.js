"use strict";

// Livraison du panneau Tickets. P12.2 (B1) : la destination est un SALON TEXTE
// passé explicitement par l'appelant (salon de l'interaction /ticketpanel) —
// plus jamais la catégorie de configuration, qui n'est pas textuelle.
class TicketPanelDeliveryService {
  constructor({ panelService, transport }) {
    this.panelService = panelService;
    this.transport = transport;
  }

  async deliver(guildId, t, channelId = null) {
    const panel = await this.panelService.build(guildId, t);
    if (!panel.ready) return { delivered: false, code: panel.code, details: {} };
    if (!channelId) return { delivered: false, code: "CHANNEL_UNAVAILABLE", details: {} };
    try {
      await this.transport.sendPanel(channelId, panel.view);
      return { delivered: true, code: null, channelId, details: {} };
    } catch (error) {
      return { delivered: false, code: "TRANSPORT_ERROR", details: {} };
    }
  }
}

module.exports = { TicketPanelDeliveryService };
