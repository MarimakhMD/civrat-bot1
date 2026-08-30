"use strict";

const { PermissionName } = require("../../core/permissions");
const { prefix } = require("../../core/interactions/routeMatchers");
const { adminCommand } = require("./commands/adminCommand");
const { AdminPanelComponentId: Id } = require("./configuration/adminPanelConstants");
const { OwnerPanelComponentId: OwnerId } = require("../owner-panel/configuration/ownerPanelConstants");
const { RecoveryComponentId: RecoveryId } = require("../recovery/configuration/recoveryConstants");
const ownerRoutes = require("../owner-panel/interactions/ownerPanelRoutes");
const routes = require("./interactions/adminPanelRoutes");

function registerAdminPanel({ registry, runtimeFactory }) {
  const runtime = () => runtimeFactory();
  const adminOnly = { allOf: [PermissionName.CIVRAT_ADMIN] };
  const ownerOnly = { allOf: [PermissionName.CIVRAT_ADMIN, PermissionName.CIVRAT_OWNER] };
  // Premium hors serveur technique reste une opération Admin. Pour la cible
  // technique, le handler puis EntitlementService exigent dynamiquement le
  // véritable Owner avec session valide ; cette garde ne peut être statique.
  const premiumMutation = adminOnly;

  registry.registerCommand({
    ...adminCommand,
    execute: (context) => routes.openDashboard(context, runtime()),
  });

  registry.registerButton({ customId: Id.HOME, permissions: adminOnly, execute: (context) => routes.openDashboard(context, runtime()) });
  registry.registerButton({ customId: Id.REFRESH, permissions: adminOnly, execute: (context) => routes.refresh(context, runtime()) });
  registry.registerButton({ customId: Id.PREMIUM, permissions: adminOnly, execute: (context) => routes.openPremium(context, runtime()) });
  registry.registerButton({ customId: Id.SERVERS, permissions: adminOnly, execute: (context) => routes.openServers(context, runtime()) });
  registry.registerButton({ customId: Id.DIAGNOSTICS, permissions: adminOnly, execute: (context) => routes.openDiagnostics(context, runtime()) });
  registry.registerButton({ customId: Id.CONFIGURATION, permissions: adminOnly, execute: (context) => routes.openConfiguration(context, runtime()) });
  registry.registerButton({ customId: Id.AUDIT, permissions: adminOnly, execute: (context) => routes.openAudit(context, runtime()) });
  registry.registerButton({ customId: Id.SEARCH, permissions: adminOnly, execute: (context) => routes.openSearch(context, runtime()) });
  registry.registerButton({ customId: Id.ACTIVATE, permissions: premiumMutation, execute: (context) => routes.openActivate(context, runtime()) });
  registry.registerButton({ customId: Id.BACK, permissions: adminOnly, execute: (context) => routes.back(context, runtime()) });
  registry.registerButton({ customId: Id.AUDIT_FILTER, permissions: adminOnly, execute: (context) => routes.openAuditFilter(context, runtime()) });

  registry.registerModal({ customId: Id.SEARCH_SUBMIT, permissions: adminOnly, execute: (context) => routes.submitSearch(context, runtime()) });
  registry.registerModal({ customId: Id.ACTIVATE_SUBMIT, permissions: premiumMutation, execute: (context) => routes.submitActivate(context, runtime()) });
  registry.registerModal({ customId: Id.REMOVE_SUBMIT, permissions: premiumMutation, execute: (context) => routes.submitDeactivate(context, runtime(), "remove") });
  registry.registerModal({ customId: Id.REVOKE_SUBMIT, permissions: premiumMutation, execute: (context) => routes.submitDeactivate(context, runtime(), "revoke") });
  registry.registerModal({ customId: Id.AUDIT_FILTER_SUBMIT, permissions: adminOnly, execute: (context) => routes.submitAuditFilter(context, runtime()) });
  registry.registerSelectMenu({ customId: Id.PREMIUM_SELECT, permissions: adminOnly, execute: (context) => routes.selectPremiumServer(context, runtime()) });

  registry.registerButton({ matcher: prefix(Id.SERVER_PREFIX), permissions: adminOnly, execute: (context) => routes.submitSearch(context, runtime()) });
  registry.registerButton({ matcher: prefix(Id.ACTIVATE_PREFIX), permissions: premiumMutation, execute: (context) => routes.openActivate(context, runtime(), context.envelope.customId.slice(Id.ACTIVATE_PREFIX.length)) });
  registry.registerButton({ matcher: prefix(Id.REMOVE_PREFIX), permissions: premiumMutation, execute: (context) => routes.openDeactivate(context, runtime(), context.envelope.customId.slice(Id.REMOVE_PREFIX.length), "remove") });
  registry.registerButton({ matcher: prefix(Id.REVOKE_PREFIX), permissions: premiumMutation, execute: (context) => routes.openDeactivate(context, runtime(), context.envelope.customId.slice(Id.REVOKE_PREFIX.length), "revoke") });
  registry.registerButton({ matcher: prefix(Id.HISTORY_PREFIX), permissions: adminOnly, execute: (context) => routes.openHistory(context, runtime(), context.envelope.customId.slice(Id.HISTORY_PREFIX.length)) });
  registry.registerButton({ matcher: prefix(Id.PREMIUM_PREV_PREFIX), permissions: adminOnly, execute: (context) => routes.openPremium(context, runtime(), pageFrom(context, Id.PREMIUM_PREV_PREFIX, -1)) });
  registry.registerButton({ matcher: prefix(Id.PREMIUM_NEXT_PREFIX), permissions: adminOnly, execute: (context) => routes.openPremium(context, runtime(), pageFrom(context, Id.PREMIUM_NEXT_PREFIX, 1)) });
  registry.registerButton({ matcher: prefix(Id.AUDIT_PREV_PREFIX), permissions: adminOnly, execute: (context) => routes.openAudit(context, runtime(), pageFrom(context, Id.AUDIT_PREV_PREFIX, -1)) });
  registry.registerButton({ matcher: prefix(Id.AUDIT_NEXT_PREFIX), permissions: adminOnly, execute: (context) => routes.openAudit(context, runtime(), pageFrom(context, Id.AUDIT_NEXT_PREFIX, 1)) });

  // Owner: le bouton n'est rendu qu'au vrai Owner ; les routes d'action
  // imposent en plus CIVRAT_OWNER et la session Master Code côté handler.
  registry.registerButton({ customId: Id.OWNER, permissions: adminOnly, execute: (context) => routes.openOwner(context, runtime()) });
  registry.registerModal({ customId: OwnerId.MASTER_SUBMIT, permissions: adminOnly, execute: (context) => routes.submitOwnerMaster(context, runtime()) });
  registry.registerButton({ customId: OwnerId.ADD_ADMIN, permissions: ownerOnly, execute: (context) => ownerRoutes.openAddAdmin(context, runtime()) });
  registry.registerButton({ customId: OwnerId.REMOVE_ADMIN, permissions: ownerOnly, execute: (context) => ownerRoutes.openRemoveAdmin(context, runtime()) });
  registry.registerButton({ customId: OwnerId.TRANSFER, permissions: ownerOnly, execute: (context) => ownerRoutes.openTransfer(context, runtime()) });
  registry.registerModal({ customId: OwnerId.ADD_ADMIN_SUBMIT, permissions: ownerOnly, execute: (context) => ownerRoutes.submitAddAdmin(context, runtime()) });
  registry.registerModal({ customId: OwnerId.REMOVE_ADMIN_SUBMIT, permissions: ownerOnly, execute: (context) => ownerRoutes.submitRemoveAdmin(context, runtime()) });
  registry.registerModal({ customId: OwnerId.TRANSFER_SUBMIT, permissions: ownerOnly, execute: (context) => ownerRoutes.submitTransfer(context, runtime()) });
  registry.registerButton({ customId: OwnerId.CONFIRM, permissions: ownerOnly, execute: (context) => ownerRoutes.confirmAction(context, runtime()) });
  registry.registerButton({ customId: OwnerId.CANCEL, permissions: ownerOnly, execute: (context) => ownerRoutes.cancelAction(context, runtime()) });

  // Recovery: même double facteur et même élévation mémoire que l'ancien
  // module, mais accessible uniquement depuis le panel technique.
  registry.registerButton({ customId: Id.RECOVERY, permissions: adminOnly, execute: (context) => routes.openRecovery(context, runtime()) });
  registry.registerButton({ customId: RecoveryId.ENTER_CODE, permissions: adminOnly, execute: (context) => routes.openRecoveryCode(context, runtime()) });
  registry.registerModal({ customId: RecoveryId.MASTER_SUBMIT, permissions: adminOnly, execute: (context) => routes.submitRecoveryMaster(context, runtime()) });
  registry.registerModal({ customId: RecoveryId.CODE_SUBMIT, permissions: adminOnly, execute: (context) => routes.submitRecoveryCode(context, runtime()) });
  registry.registerButton({ customId: OwnerId.RECOVERY_TRANSFER, permissions: adminOnly, execute: (context) => ownerRoutes.openRecoveryTransfer(context, runtime()) });
  registry.registerModal({ customId: OwnerId.RECOVERY_TRANSFER_SUBMIT, permissions: adminOnly, execute: (context) => ownerRoutes.submitRecoveryTransfer(context, runtime()) });
  registry.registerButton({ customId: OwnerId.RECOVERY_CONFIRM, permissions: adminOnly, execute: (context) => ownerRoutes.confirmRecoveryAction(context, runtime()) });
  registry.registerButton({ customId: OwnerId.RECOVERY_CANCEL, permissions: adminOnly, execute: (context) => ownerRoutes.cancelRecoveryAction(context, runtime()) });

  return { commands: [adminCommand], routes };
}

function pageFrom(context, prefixId, delta) {
  const raw = context.envelope.customId.slice(prefixId.length);
  const page = Number.parseInt(raw, 10);
  return (Number.isInteger(page) ? page : 0) + delta;
}

module.exports = { registerAdminPanel };
