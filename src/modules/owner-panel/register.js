"use strict";

const { PermissionName } = require("../../core/permissions");
const { OwnerPanelComponentId: Id } = require("./configuration/ownerPanelConstants");
const routes = require("./interactions/ownerPanelRoutes");

// P20 — enregistrement modulaire du Owner Panel CIVRAT.
//
// - La COMMANDE `/ownerpanel` et la soumission du Master Code sont publiques
//   côté route : le contrôle d'ouverture (Owner / Admin CIVRAT / élévation
//   Recovery) est dynamique (état en mémoire) et appliqué dans les handlers
//   avec une réponse générique éphémère — VOIR ≠ accéder au contenu.
// - Toutes les routes d'ACTION portent { allOf: [PermissionName.CIVRAT_OWNER] } :
//   la couture core prévue les vérifie via le router. Un Admin CIVRAT
//   authentifié ne peut JAMAIS exécuter une action Owner.
function registerOwnerPanel({ registry, runtimeFactory }) {
  const runtime = () => runtimeFactory();
  const ownerOnly = { allOf: [PermissionName.CIVRAT_OWNER] };
  const open = { allOf: [] };

  const command = {
    name: "ownerpanel",
    description: "Panneau propriétaire CIVRAT (Owner/Admins CIVRAT)",
    permissions: open,
    options: [],
    execute: (context) => routes.openOwnerPanel(context, runtime()),
  };
  registry.registerCommand(command);
  registry.registerModal({ customId: Id.MASTER_SUBMIT, permissions: open, execute: (context) => routes.submitMasterCode(context, runtime()) });

  registry.registerButton({ customId: Id.ADD_ADMIN, permissions: ownerOnly, execute: (context) => routes.openAddAdmin(context, runtime()) });
  registry.registerButton({ customId: Id.REMOVE_ADMIN, permissions: ownerOnly, execute: (context) => routes.openRemoveAdmin(context, runtime()) });
  registry.registerButton({ customId: Id.TRANSFER, permissions: ownerOnly, execute: (context) => routes.openTransfer(context, runtime()) });

  registry.registerModal({ customId: Id.ADD_ADMIN_SUBMIT, permissions: ownerOnly, execute: (context) => routes.submitAddAdmin(context, runtime()) });
  registry.registerModal({ customId: Id.REMOVE_ADMIN_SUBMIT, permissions: ownerOnly, execute: (context) => routes.submitRemoveAdmin(context, runtime()) });
  registry.registerModal({ customId: Id.TRANSFER_SUBMIT, permissions: ownerOnly, execute: (context) => routes.submitTransfer(context, runtime()) });

  registry.registerButton({ customId: Id.CONFIRM, permissions: ownerOnly, execute: (context) => routes.confirmAction(context, runtime()) });
  registry.registerButton({ customId: Id.CANCEL, permissions: ownerOnly, execute: (context) => routes.cancelAction(context, runtime()) });

  // P20.1 — canal de récupération. Routes volontairement SANS
  // CIVRAT_OWNER : leur garde est l'élévation Recovery active, revérifiée
  // dans chaque handler (requireElevation) puis dans le service. Accorder
  // CIVRAT_OWNER ici serait exactement la promotion interdite par le brief.
  registry.registerButton({ customId: Id.RECOVERY_MASTER, permissions: open, execute: (context) => routes.openRecoveryMaster(context, runtime()) });
  registry.registerButton({ customId: Id.RECOVERY_TRANSFER, permissions: open, execute: (context) => routes.openRecoveryTransfer(context, runtime()) });
  registry.registerModal({ customId: Id.RECOVERY_TRANSFER_SUBMIT, permissions: open, execute: (context) => routes.submitRecoveryTransfer(context, runtime()) });
  registry.registerButton({ customId: Id.RECOVERY_CONFIRM, permissions: open, execute: (context) => routes.confirmRecoveryAction(context, runtime()) });
  registry.registerButton({ customId: Id.RECOVERY_CANCEL, permissions: open, execute: (context) => routes.cancelRecoveryAction(context, runtime()) });

  return { commands: [command] };
}

module.exports = { registerOwnerPanel };
