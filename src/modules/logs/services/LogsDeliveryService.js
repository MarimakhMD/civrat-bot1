"use strict";

/**
 * PHASE 1 — motifs d'échec distincts et diagnostic des détails non mappés.
 *
 * Deux ajouts :
 *  • `log_embed_empty`, `log_guild_unavailable` et `log_channel_unavailable`
 *    remontent chacun sous leur propre motif. Avant, un embed vide ou une
 *    guilde inexploitable finissaient tous deux en « LOG_TRANSPORT_FAILED »,
 *    indiscernables d'une vraie erreur HTTP.
 *  • les clés de `details` qu'aucun rendu ne sait afficher sont signalées au
 *    logger. Elles ne sont plus publiées telles quelles (clés techniques
 *    visibles par les membres), mais leur disparition silencieuse serait tout
 *    aussi mauvaise : le mapping manquant devient visible.
 */

const REASON_BY_ERROR = Object.freeze({
  log_embed_empty: "LOG_EMBED_EMPTY",
  log_guild_unavailable: "LOG_GUILD_UNAVAILABLE",
  log_channel_unavailable: "LOG_CHANNEL_UNAVAILABLE",
});

function reasonFor(error) {
  const message = error && typeof error.message === "string" ? error.message : "";
  return REASON_BY_ERROR[message] || "LOG_TRANSPORT_FAILED";
}

class LogsDeliveryService {
  constructor({ transport, logger = null, detailInspector = null }) {
    this.transport = transport;
    this.logger = logger;
    this.detailInspector = detailInspector;
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

    this.reportUnmappedDetails(entry);

    try {
      await this.transport.deliver(entry);
      return { delivered: true, reason: null, details: {} };
    } catch (error) {
      // Diagnostic enrichi : le transport lève des erreurs dont le message
      // générique (« Received one or more errors ») masque la cause. On
      // conserve ici les champs structurés permettant d'identifier le champ
      // fautif (50035 Invalid Form Body) ou l'erreur HTTP sous-jacente.
      const reason = reasonFor(error);
      this.logger?.warn?.("Log delivery failed", {
        reason,
        channelId: entry.channelId,
        guildId: entry.guildId || null,
        category: entry.category,
        action: entry.action,
        error: error?.message || String(error),
        code: error?.code ?? null,
        status: error?.status ?? null,
        errors: error?.errors ?? null,
        rawError: error?.rawError ?? null,
        requestBody: error?.requestBody ?? null,
      });
      return { delivered: false, reason, details: {} };
    }
  }

  /** Signale les clés de `details` sans libellé connu. Jamais bloquant. */
  reportUnmappedDetails(entry) {
    if (typeof this.detailInspector !== "function") return;
    let unmapped;
    try {
      unmapped = this.detailInspector(entry);
    } catch {
      return;
    }
    if (!Array.isArray(unmapped) || unmapped.length === 0) return;
    this.logger?.warn?.("Log entry carries details with no rendering", {
      reason: "LOG_DETAILS_UNMAPPED",
      guildId: entry.guildId || null,
      category: entry.category,
      action: entry.action,
      unmapped,
    });
  }
}

module.exports = { LogsDeliveryService, reasonFor, REASON_BY_ERROR };
