"use strict";
class CaptchaPanelDeliveryService {
  constructor({ panelService, transport }) {
    this.panelService = panelService;
    this.transport = transport;
  }

  async deliver(guildId, t) {
    const panel = await this.panelService.build(guildId, t);
    if (!panel.ready) return { delivered: false, reason: panel.reason, details: {} };
    await this.transport.sendPanel(panel.channelId, panel.view);
    return { delivered: true, reason: null, channelId: panel.channelId, details: { roleId: panel.roleId } };
  }
}
module.exports = { CaptchaPanelDeliveryService };
