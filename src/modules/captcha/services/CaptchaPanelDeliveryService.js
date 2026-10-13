"use strict";

const { CaptchaConfigKey: Key } = require("../configuration/captchaConstants");

// Dédoublonnage : un seul delivery en cours par serveur (jamais de panneaux
// officiels concurrents). Volatil, strictement en mémoire.
const activeDeliveries = new Map();
// Fallback des IDs pour les runtimes sans configService (tests legacy) :
// guildId -> { channelId, messageId }. La config persistante prime.
const activePanels = new Map();

/**
 * P-CAPT L2 — panneau officiel unique.
 *
 *  • les IDs persistés (`captcha_panel_channel_id` / `captcha_panel_message_id`)
 *    sont la source de vérité entre les redémarrages ; la Map ne reste qu'un
 *    repli pour les runtimes sans configService ;
 *  • toute régénération supprime l'ancien panneau (best-effort) AVANT d'en
 *    publier un nouveau, puis persiste les nouveaux IDs ;
 *  • un delivery déjà en cours sur la même guilde est refusé (pas de
 *    panneaux concurrents) ;
 *  • un ancien panneau oublié malgré tout reste sans danger : il pointe sur
 *    le même bouton `verify` et la session reste gérée par le store (L1).
 */
class CaptchaPanelDeliveryService {
  constructor({ panelService, transport, configService = null }) {
    this.panelService = panelService;
    this.transport = transport;
    this.configService = configService;
  }

  async #readStored(guildId) {
    if (this.configService) {
      try {
        const config = await this.configService.read(guildId);
        const channelId = config?.[Key.PANEL_CHANNEL_ID] || null;
        const messageId = config?.[Key.PANEL_MESSAGE_ID] || null;
        if (channelId && messageId) return { channelId, messageId, source: "config" };
      } catch {
        // repli sur la Map ci-dessous
      }
    }
    return activePanels.get(guildId) || null;
  }

  async #persist(guildId, entry) {
    activePanels.set(guildId, entry);
    if (!this.configService) return false;
    try {
      await this.configService.update(guildId, {
        [Key.PANEL_CHANNEL_ID]: entry.channelId,
        [Key.PANEL_MESSAGE_ID]: entry.messageId,
      });
      return true;
    } catch {
      // Colonne absente ou écriture refusée : la Map garde l'ID pour cette
      // session ; l'appelant reste informé via le résultat.
      return false;
    }
  }

  async #clearStored(guildId, previous) {
    activePanels.delete(guildId);
    if (previous?.source !== "config" || !this.configService) return;
    try {
      await this.configService.update(guildId, { [Key.PANEL_CHANNEL_ID]: null, [Key.PANEL_MESSAGE_ID]: null });
    } catch {
      // nettoyage best-effort : le nouveau delivery repersistera les IDs.
    }
  }

  async deliver(guildId, t) {
    const panel = await this.panelService.build(guildId, t);
    if (!panel.ready) return { delivered: false, reason: panel.reason, details: {} };

    if (activeDeliveries.has(guildId)) {
      return { delivered: false, reason: "captcha.panelDeliveryInProgress", details: {} };
    }
    activeDeliveries.set(guildId, true);
    try {
      // 1. Ancien panneau supprimé d'abord (source : config persistée, sinon Map).
      const previous = await this.#readStored(guildId);
      if (previous) {
        try {
          await this.transport.deletePanel?.(previous.channelId, previous.messageId);
        } catch {
          // suppression best-effort : sans gravité
        }
        await this.#clearStored(guildId, previous);
      }

      // 2. Nouveau panneau officiel.
      const message = await this.transport.sendPanel(panel.channelId, panel.view);
      const messageId = typeof message?.id === "string" ? message.id : null;

      // 3. Persistance des nouveaux IDs (best-effort si l'ID est indisponible).
      const persisted = messageId ? await this.#persist(guildId, { channelId: panel.channelId, messageId }) : false;

      return {
        delivered: true,
        reason: null,
        channelId: panel.channelId,
        messageId,
        regenerated: Boolean(previous),
        persisted,
        details: { roleId: panel.roleId },
      };
    } finally {
      activeDeliveries.delete(guildId);
    }
  }
}

module.exports = { CaptchaPanelDeliveryService, activePanels, activeDeliveries };
