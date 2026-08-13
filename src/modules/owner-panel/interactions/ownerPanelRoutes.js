"use strict";

const { OwnerPanelFieldId: Field, PendingActionType } = require("../configuration/ownerPanelConstants");
const { isDiscordId } = require("../services/CivratIdentityService");
const views = require("./ownerPanelViews");

// P20 — routes du Owner Panel.
//
// Modèle d'accès (ne jamais déroger) :
//  1. OUVERTURE : Owner CIVRAT, Admin CIVRAT ou élévation Recovery active
//     (canOpen). Tout le reste reçoit la réponse générique éphémère —
//     VOIR la commande n'ouvre jamais le contenu ;
//  2. CONTENU : exige l'authentification par OWNER_PANEL_MASTER_CODE
//     (session courte, en mémoire). Sans elle : aucune donnée ;
//  3. ACTIONS Owner : les routes sensibles portent EN PLUS
//     { allOf: [PermissionName.CIVRAT_OWNER] } (vérifié par le router) —
//     un Admin CIVRAT ne peut JAMAIS les exécuter, même avec une session ;
//  4. Chaque action exige une confirmation explicite (pending à durée
//     limitée, consommée une fois) ;
//  5. Le transfert Owner exige OWNER_TRANSFER_CODE + confirmation finale.

async function canOpen(context, runtime) {
  const userId = context.userId;
  return (await runtime.identity.isOwnerOrAdmin(userId)) || runtime.hasRecoveryElevation(userId);
}

async function requireSession(context, runtime) {
  if (!runtime.panel.authenticate(context.userId)) {
    await replyRefused(context);
    return false;
  }
  return true;
}

async function replyRefused(context) {
  return context.envelope.transport.reply({ view: views.refusedView(context.t), ephemeral: true });
}

function readField(context, fieldId) {
  const values = context.envelope.modalValues || {};
  const value = values[fieldId];
  return typeof value === "string" ? value.trim() : "";
}

// 1. Ouverture : Owner/Admin => modale du Master Code (P20 inchangé) ;
// utilisateur avec élévation Recovery active (et ni Owner ni Admin) => vue
// de récupération (P20.1) ; tout le reste => refus générique.
async function openOwnerPanel(context, runtime) {
  if (await runtime.identity.isOwnerOrAdmin(context.userId)) {
    return context.envelope.transport.showModal(views.masterModal(context.t));
  }
  if (!runtime.hasRecoveryElevation(context.userId)) return replyRefused(context);
  // P20.1 — canal de récupération : aucune donnée d'identité affichée,
  // seule action proposée = transfert Owner (sous Transfer Code + confirm).
  return context.envelope.transport.reply({ view: views.recoveryView(context.t), ephemeral: true });
}

// 2. Soumission du Master Code : session + panneau (ou refus générique).
async function submitMasterCode(context, runtime) {
  if (!(await canOpen(context, runtime))) return replyRefused(context);
  const result = runtime.panel.tryAuthenticate(context.userId, readField(context, Field.MASTER));
  if (!result.ok) return replyRefused(context);
  return context.envelope.transport.reply({ view: await buildPanelView(context, runtime), ephemeral: true });
}

async function buildPanelView(context, runtime) {
  const [ownerId, adminIds, viewerIsOwner] = await Promise.all([
    runtime.identity.getOwnerId(),
    runtime.identity.listAdminIds(),
    runtime.identity.isOwner(context.userId),
  ]);
  return views.panelView(context.t, { viewerIsOwner, ownerId, adminIds });
}

// 3. Ouvertures des actions (Owner-only par la route ; session ici).
async function openAddAdmin(context, runtime) {
  if (!(await requireSession(context, runtime))) return null;
  return context.envelope.transport.showModal(views.addAdminModal(context.t));
}

async function openRemoveAdmin(context, runtime) {
  if (!(await requireSession(context, runtime))) return null;
  return context.envelope.transport.showModal(views.removeAdminModal(context.t));
}

async function openTransfer(context, runtime) {
  if (!(await requireSession(context, runtime))) return null;
  return context.envelope.transport.showModal(views.transferModal(context.t));
}

// 4. Soumissions d'actions => validations + confirmation explicite.
async function submitAddAdmin(context, runtime) {
  if (!(await requireSession(context, runtime))) return null;
  const targetId = readField(context, Field.TARGET_ID);
  if (!isDiscordId(targetId) || (await runtime.identity.isOwner(targetId)) || (await runtime.identity.isAdmin(targetId))) {
    return replyRefused(context);
  }
  runtime.panel.setPending(context.userId, { type: PendingActionType.ADD_ADMIN, targetId });
  return context.envelope.transport.update({ view: views.confirmView(context.t, { textKey: "ownerpanel.confirmAddAdmin", targetId }) });
}

async function submitRemoveAdmin(context, runtime) {
  if (!(await requireSession(context, runtime))) return null;
  const targetId = readField(context, Field.TARGET_ID);
  if (!isDiscordId(targetId) || !(await runtime.identity.isAdmin(targetId))) {
    return replyRefused(context);
  }
  runtime.panel.setPending(context.userId, { type: PendingActionType.REMOVE_ADMIN, targetId });
  return context.envelope.transport.update({ view: views.confirmView(context.t, { textKey: "ownerpanel.confirmRemoveAdmin", targetId }) });
}

async function submitTransfer(context, runtime) {
  if (!(await requireSession(context, runtime))) return null;
  // OWNER_TRANSFER_CODE : vérification stricte (timing-safe + anti force
  // brute partagé), refus générique.
  if (!runtime.panel.verifyTransferCode(context.userId, readField(context, Field.TRANSFER_CODE))) {
    return replyRefused(context);
  }
  const newOwnerId = readField(context, Field.NEW_OWNER_ID);
  if (!isDiscordId(newOwnerId) || (await runtime.identity.isOwner(newOwnerId))) {
    return replyRefused(context);
  }
  runtime.panel.setPending(context.userId, { type: PendingActionType.TRANSFER_OWNER, targetId: newOwnerId });
  return context.envelope.transport.update({ view: views.confirmView(context.t, { textKey: "ownerpanel.confirmTransfer", targetId: newOwnerId }) });
}

// 5. Confirmation finale.
async function confirmAction(context, runtime) {
  if (!(await requireSession(context, runtime))) return null;
  const pending = runtime.panel.consumePending(context.userId);
  if (!pending) {
    return context.envelope.transport.update({ view: views.resultView(context.t, "ownerpanel.actionExpired") });
  }
  let result;
  if (pending.type === PendingActionType.ADD_ADMIN) {
    result = await runtime.identity.addAdmin({ actorId: context.userId, targetId: pending.targetId });
  } else if (pending.type === PendingActionType.REMOVE_ADMIN) {
    result = await runtime.identity.removeAdmin({ actorId: context.userId, targetId: pending.targetId });
  } else if (pending.type === PendingActionType.TRANSFER_OWNER) {
    result = await runtime.identity.transferOwnership({ actorId: context.userId, newOwnerId: pending.targetId });
  } else {
    result = { ok: false, code: "UNKNOWN_ACTION" };
  }
  const key = result.ok
    ? pending.type === PendingActionType.ADD_ADMIN
      ? "ownerpanel.adminAdded"
      : pending.type === PendingActionType.REMOVE_ADMIN
        ? "ownerpanel.adminRemoved"
        : "ownerpanel.ownerTransferred"
    : "ownerpanel.actionRefused";
  return context.envelope.transport.update({ view: views.resultView(context.t, key) });
}

async function cancelAction(context, runtime) {
  runtime.panel.consumePending(context.userId);
  return context.envelope.transport.update({ view: views.resultView(context.t, "ownerpanel.cancelled") });
}

// ————————————————————————————————————————————————————————————————
// P20.1 — CANAL DE RÉCUPÉRATION (transfert Owner par élévation Recovery).
//
// Garde UNIQUE et OBLIGATOIRE de ce canal : l'élévation Recovery ACTIVE,
// revérifiée dans CHAQUE handler (défense en profondeur : handler + service
// `transferOwnershipViaRecovery`). CIVRAT_OWNER n'est jamais impliqué ni
// accordé ici ; un simple Admin n'a aucune élévation => jamais de transfert.
// Réutilise les systèmes EXISTANTS : Transfer Code timing-safe + anti force
// brute (OwnerPanelService), confirmations single-use (pending), réponses
// génériques éphémères.
// ————————————————————————————————————————————————————————————————

async function requireElevation(context, runtime) {
  if (!runtime.hasRecoveryElevation(context.userId)) {
    await replyRefused(context);
    return false;
  }
  return true;
}

// « S'identifier (Master Code) » : préserve l'accès lecture P20 pour un
// utilisateur élevé (la soumission passe par la route MASTER_SUBMIT déjà
// existante, qui revérifie canOpen).
async function openRecoveryMaster(context, runtime) {
  if (!(await requireElevation(context, runtime))) return null;
  return context.envelope.transport.showModal(views.masterModal(context.t));
}

async function openRecoveryTransfer(context, runtime) {
  if (!(await requireElevation(context, runtime))) return null;
  return context.envelope.transport.showModal(views.recoveryTransferModal(context.t));
}

async function submitRecoveryTransfer(context, runtime) {
  if (!(await requireElevation(context, runtime))) return null;
  if (!runtime.panel.verifyTransferCode(context.userId, readField(context, Field.TRANSFER_CODE))) {
    return replyRefused(context);
  }
  const newOwnerId = readField(context, Field.NEW_OWNER_ID);
  if (!isDiscordId(newOwnerId) || (await runtime.identity.isOwner(newOwnerId))) {
    return replyRefused(context);
  }
  runtime.panel.setPending(context.userId, { type: PendingActionType.RECOVERY_TRANSFER, targetId: newOwnerId });
  return context.envelope.transport.update({ view: views.confirmView(context.t, { textKey: "ownerpanel.confirmTransfer", targetId: newOwnerId }) });
}

// Confirmation finale du transfert par récupération. L'élévation doit être
// ENCORE active au moment de la confirmation (matrice : expirée => refus).
async function confirmRecoveryAction(context, runtime) {
  if (!(await requireElevation(context, runtime))) return null;
  const pending = runtime.panel.consumePending(context.userId);
  if (!pending || pending.type !== PendingActionType.RECOVERY_TRANSFER) {
    return context.envelope.transport.update({ view: views.resultView(context.t, "ownerpanel.actionExpired") });
  }
  const result = await runtime.identity.transferOwnershipViaRecovery({
    actorId: context.userId,
    newOwnerId: pending.targetId,
  });
  return context.envelope.transport.update({
    view: views.resultView(context.t, result.ok ? "ownerpanel.ownerTransferred" : "ownerpanel.actionRefused"),
  });
}

async function cancelRecoveryAction(context, runtime) {
  if (!(await requireElevation(context, runtime))) return null;
  runtime.panel.consumePending(context.userId);
  return context.envelope.transport.update({ view: views.resultView(context.t, "ownerpanel.cancelled") });
}

module.exports = {
  canOpen,
  openOwnerPanel,
  submitMasterCode,
  openAddAdmin,
  openRemoveAdmin,
  openTransfer,
  submitAddAdmin,
  submitRemoveAdmin,
  submitTransfer,
  confirmAction,
  cancelAction,
  openRecoveryMaster,
  openRecoveryTransfer,
  submitRecoveryTransfer,
  confirmRecoveryAction,
  cancelRecoveryAction,
};
