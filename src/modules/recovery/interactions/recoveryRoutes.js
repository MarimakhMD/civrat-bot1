"use strict";

const { RecoveryFieldId: Field } = require("../configuration/recoveryConstants");
const { masterModal, enterCodeReplyView, codeModal, resultReplyView } = require("./recoveryViews");

// P20 — routes du flux de récupération. La commande est volontairement
// PUBLIQUE (un non-administrateur doit pouvoir lancer la récupération) ;
// toute la sécurité repose sur le double facteur côté service.
//
// Anti-oracle appliqué : la saisie du Master Code reçoit TOUJOURS la même
// réponse générique (« demande reçue » + bouton de saisie du code), qu'il
// soit juste, faux ou que le système soit indisponible — impossible de
// tester des Master Codes en force depuis Discord. L'échec éventuel
// n'apparaît que dans les logs serveur génériques (sans valeur).

async function startRecovery(context) {
  return context.envelope.transport.showModal(masterModal(context.t));
}

async function submitMaster(context, service) {
  const values = context.envelope.modalValues || {};
  await service.requestRecovery({
    guildId: context.guildId,
    userId: context.userId,
    masterCode: values[Field.MASTER],
  });
  await context.envelope.transport.reply({ view: enterCodeReplyView(context.t), ephemeral: true });
}

async function openCodeModal(context) {
  return context.envelope.transport.showModal(codeModal(context.t));
}

async function submitCode(context, service) {
  const values = context.envelope.modalValues || {};
  const result = await service.verifyRecovery({
    guildId: context.guildId,
    userId: context.userId,
    code: values[Field.TEMP_CODE],
  });
  // Réponse publique binaire et générique — les codes internes détaillés
  // restent côté serveur (logs d'événements sans valeur sensible).
  const key = result.recovered ? "recovery.verified" : "recovery.codeRefused";
  await context.envelope.transport.reply({ view: resultReplyView(context.t, key), ephemeral: true });
  return result;
}

module.exports = { startRecovery, submitMaster, openCodeModal, submitCode };
