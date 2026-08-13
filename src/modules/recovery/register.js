"use strict";

const { RecoveryComponentId: Id } = require("./configuration/recoveryConstants");
const { startRecovery, submitMaster, openCodeModal, submitCode } = require("./interactions/recoveryRoutes");

// P20 — enregistrement modulaire de la récupération propriétaire.
// La commande /recovery est PUBLIQUE par conception (permissions allOf: [] —
// mêmes conventions que les actions publiques des autres modules) : un
// utilisateur non administrateur doit pouvoir démarrer la procédure. Toute
// la sécurité est portée par le double facteur du service.
function registerRecovery({ registry, serviceFactory }) {
  const command = {
    name: "recovery",
    description: "Récupération propriétaire (code maître + code e-mail)",
    permissions: { allOf: [] },
    options: [],
    execute: startRecovery,
  };
  registry.registerCommand(command);
  registry.registerButton({ customId: Id.ENTER_CODE, permissions: { allOf: [] }, execute: openCodeModal });
  registry.registerModal({ customId: Id.MASTER_SUBMIT, permissions: { allOf: [] }, execute: async (context) => submitMaster(context, serviceFactory(context)) });
  registry.registerModal({ customId: Id.CODE_SUBMIT, permissions: { allOf: [] }, execute: async (context) => submitCode(context, serviceFactory(context)) });
  return { commands: [command] };
}

module.exports = { registerRecovery };
