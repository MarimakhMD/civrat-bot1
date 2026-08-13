"use strict";

const { RecoveryCodeStore } = require("../services/RecoveryCodeStore");
const { RecoveryService } = require("../services/RecoveryService");
const { readSmtpConfig } = require("../mail/SmtpConfig");
const { SmtpMailer } = require("../mail/SmtpMailer");

// P20 — runtime partagé de la récupération (pattern getTicketPanelRuntime :
// singleton paresseux). Le store est commun à toutes les interactions du
// processus : un code demandé via une interaction peut être vérifié via une
// autre. Un redémarrage du bot vide le store (les codes en cours deviennent
// invalides — comportement assumé et testé).
//
// Les secrets sont lus À LA DEMANDE dans process.env (jamais copiés, jamais
// loggés) : une rotation côté hosting ne nécessite qu'un redémarrage.
let runtime = null;

function getRecoveryRuntime() {
  if (!runtime) {
    const store = new RecoveryCodeStore();
    runtime = Object.freeze({
      store,
      serviceFactory: () => new RecoveryService({
        store,
        env: {
          masterCode: () => process.env.RECOVERY_MASTER_CODE || null,
          recoveryEmail: () => process.env.RECOVERY_EMAIL || null,
        },
        mailer: buildMailer(),
      }),
      // P20 — lien Recovery → Owner Panel : élévation temporaire partagée,
      // lue DANS le store commun à tout le processus (fail-closed : un
      // redémarrage l'efface). Ne donne que l'OUVERTURE du panel.
      hasActiveElevation: (userId) => store.hasActiveElevation(userId, Date.now()),
      // P20.1 — une élévation est consommée après un transfert Owner via
      // récupération réussi : elle ne peut jamais servir deux fois.
      clearElevation: (userId) => store.clearElevation(userId),
    });
  }
  return runtime;
}

// La config SMTP est relue à chaque demande : une mise à jour des variables
// suivie d'un simple redémarrage du processus suffit. Sans config complète,
// pas de mailer => requestRecovery => RECOVERY_UNAVAILABLE (fail-closed).
function buildMailer() {
  const config = readSmtpConfig();
  return config ? new SmtpMailer({ config }) : null;
}

module.exports = { getRecoveryRuntime };
