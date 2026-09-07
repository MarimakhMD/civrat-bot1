"use strict";

const logger = require("../utils/logger");

/**
 * B5-c — réconciliation TempVoice au démarrage.
 *
 * Le handler `ready` est le bon point d'ancrage : il est émis une seule fois,
 * après que le cache des guildes/salons est complet (intent Guilds), ce qui
 * permet de vérifier l'existence et la vacuité des salons persistés sans
 * conclure à tort qu'un salon est orphelin sur un cache incomplet.
 *
 * Le cleanup est strictement best-effort : un échec est loggé, jamais fatal, et
 * n'empêche pas le bot de démarrer (le wrapper de loadEvents capture aussi les
 * exceptions, par sécurité).
 */
module.exports = {
  name: "ready",
  once: true,
  async execute(client) {
    try {
      await require("../modules/tempvoice/runtime/getTempVoiceRuntime").getTempVoiceRuntime().reconcileOnStartup(client);
    } catch (error) {
      logger.warn("tempvoice startup reconciliation failed", {
        event: "tempvoice_reconcile_failed",
        error: error && error.message ? error.message : String(error),
      });
    }
  },
};
