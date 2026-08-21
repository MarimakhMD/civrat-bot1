"use strict";

// Dédoublonnage en mémoire des panels persistants : guildId -> { channelId, messageId }.
// Un seul panel CAPTCHA actif par serveur. Le cache est volatil (perdu au
// redémarrage) : c'est le comportement choisi (zéro migration), les éventuels
// panels orphelins restant simplement cliquables mais tous branchés sur le
// même bouton `civrat:v1:captcha:verify`.
const activePanels = new Map();

class CaptchaPanelDeliveryService {
  constructor({ panelService, transport }) {
    this.panelService = panelService;
    this.transport = transport;
  }

  async deliver(guildId, t) {
    const panel = await this.panelService.build(guildId, t);
    if (!panel.ready) return { delivered: false, reason: panel.reason, details: {} };

    // Supprime l'ancien panel du serveur avant d'en publier un nouveau.
    const previous = activePanels.get(guildId);
    if (previous) {
      try {
        await this.transport.deletePanel?.(previous.channelId, previous.messageId);
      } catch {
        // suppression best-effort : sans gravité
      }
      activePanels.delete(guildId);
    }

    const message = await this.transport.sendPanel(panel.channelId, panel.view);
    const messageId = typeof message?.id === "string" ? message.id : null;
    if (messageId) activePanels.set(guildId, { channelId: panel.channelId, messageId });

    return { delivered: true, reason: null, channelId: panel.channelId, messageId, details: { roleId: panel.roleId } };
  }
}

module.exports = { CaptchaPanelDeliveryService, activePanels };
