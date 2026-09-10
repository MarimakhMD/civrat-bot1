"use strict";

class LogsDeliveryService {
  constructor({ transport, logger = null }) {
    this.transport = transport;
    this.logger = logger;
  }

  async deliver(entry) {
    if (!entry.channelId) {
      this.logger?.warn?.("Log delivery skipped: no channel configured", {
        reason: "LOG_CHANNEL_NOT_CONFIGURED",
        category: entry.category,
        action: entry.action,
      });
      return { delivered: false, reason: "LOG_CHANNEL_NOT_CONFIGURED", details: {} };
    }

    try {
      await this.transport.deliver(entry);
      return { delivered: true, reason: null, details: {} };
    } catch (error) {
      this.logger?.warn?.("Log delivery failed", {
        reason: "LOG_TRANSPORT_FAILED",
        channelId: entry.channelId,
        category: entry.category,
        action: entry.action,
        error: error?.message || String(error),
      });
      return { delivered: false, reason: "LOG_TRANSPORT_FAILED", details: {} };
    }
  }
}

module.exports = { LogsDeliveryService };
