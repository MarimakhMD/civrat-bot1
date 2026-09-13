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
      // Diagnostic enrichi : DiscordLogsTransport lève un DiscordAPIError
      // dont le message générique ("Received one or more errors") masque la
      // cause. On conserve ici les champs structurés permettant d'identifier
      // le champ fautif (50035 Invalid Form Body) ou l'erreur HTTP sous-jacente.
      this.logger?.warn?.("Log delivery failed", {
        reason: "LOG_TRANSPORT_FAILED",
        channelId: entry.channelId,
        category: entry.category,
        action: entry.action,
        error: error?.message || String(error),
        code: error?.code ?? null,
        status: error?.status ?? null,
        errors: error?.errors ?? null,
        rawError: error?.rawError ?? null,
        requestBody: error?.requestBody ?? null,
      });
      return { delivered: false, reason: "LOG_TRANSPORT_FAILED", details: {} };
    }
  }
}

module.exports = { LogsDeliveryService };
