"use strict";

const { OwnerPanelComponentId: Id, OwnerPanelFieldId: Field } = require("../configuration/ownerPanelConstants");
const { AdminPanelComponentId: AdminId } = require("../../admin-panel/configuration/adminPanelConstants");

// P20 — vues du Owner Panel. Tout le texte passe par l'i18n du module
// (EN/FR, parité vérifiée). Règles d'affichage :
//  - toutes les réponses sensibles sont ÉPHÉMÈRES (le transport les envoie
//    avec ephemeral: true) ;
//  - aucune valeur saisie (Master Code, Transfer Code) n'est réaffichée :
//    les modales sont toujours vides à l'ouverture ;
//  - le refus est une vue générique UNIQUE (non autorisé, mauvais code,
//    verrouillage, indisponible : même réponse — aucune fuite oracle) ;
//  - le panneau distingue clairement Owner et Admins, et les boutons
//    d'action ne sont rendus QUE pour le Owner.

function masterModal(t) {
  return {
    customId: Id.MASTER_SUBMIT,
    title: t("ownerpanel.masterModalTitle"),
    fields: [{ id: Field.MASTER, label: t("ownerpanel.masterField"), value: "", required: true, style: "short" }],
  };
}

function refusedView(t) {
  return { title: t("ownerpanel.title"), content: t("ownerpanel.refused"), components: [] };
}

function panelView(t, { viewerIsOwner, ownerId, adminIds }) {
  const ownerLabel = ownerId ? `<@${ownerId}> (\`${ownerId}\`)` : t("ownerpanel.ownerNone");
  const admins = adminIds.length > 0 ? adminIds.map((id) => `<@${id}> (\`${id}\`)`).join("\n") : t("ownerpanel.adminsNone");
  const content = [
    t("ownerpanel.ownerLine", { owner: ownerLabel }),
    t("ownerpanel.adminsLine", { admins }),
    viewerIsOwner ? t("ownerpanel.youAreOwner") : t("ownerpanel.youAreViewer"),
  ].join("\n");
  const components = viewerIsOwner
    ? [
        { type: "button", customId: Id.ADD_ADMIN, label: t("ownerpanel.addAdmin"), style: "primary" },
        { type: "button", customId: Id.REMOVE_ADMIN, label: t("ownerpanel.removeAdmin"), style: "secondary" },
        { type: "button", customId: Id.TRANSFER, label: t("ownerpanel.transferOwner"), style: "danger" },
        // L'Owner garde aussi toutes les fonctions opérationnelles du panel.
        { type: "button", customId: AdminId.HOME, label: t("ownerpanel.adminOperations"), style: "secondary" },
      ]
    : [];
  return { title: t("ownerpanel.title"), content, components };
}

function addAdminModal(t) {
  return {
    customId: Id.ADD_ADMIN_SUBMIT,
    title: t("ownerpanel.idModalTitleAdd"),
    fields: [{ id: Field.TARGET_ID, label: t("ownerpanel.idField"), value: "", required: true, style: "short" }],
  };
}

function removeAdminModal(t) {
  return {
    customId: Id.REMOVE_ADMIN_SUBMIT,
    title: t("ownerpanel.idModalTitleRemove"),
    fields: [{ id: Field.TARGET_ID, label: t("ownerpanel.idField"), value: "", required: true, style: "short" }],
  };
}

function transferModal(t) {
  return {
    customId: Id.TRANSFER_SUBMIT,
    title: t("ownerpanel.transferModalTitle"),
    fields: [
      { id: Field.TRANSFER_CODE, label: t("ownerpanel.transferCodeField"), value: "", required: true, style: "short" },
      { id: Field.NEW_OWNER_ID, label: t("ownerpanel.transferNewOwnerField"), value: "", required: true, style: "short" },
    ],
  };
}

// P20.1 — vue du canal de récupération (élévation Recovery active requise,
// revérifiée par les handlers). AUCUNE donnée d'identité n'est affichée ici
// (ni Owner ni Admins : aucun pouvoir supplémentaire) — une seule action :
// le transfert Owner. Le second bouton préserve l'accès lecture P20 via le
// Master Code.
function recoveryView(t) {
  return {
    title: t("ownerpanel.title"),
    content: t("ownerpanel.recoveryNotice"),
    components: [
      { type: "button", customId: Id.RECOVERY_TRANSFER, label: t("ownerpanel.transferOwner"), style: "danger" },
    ],
  };
}

// P20.1 — même saisie que la modale Owner (Transfer Code + nouvel ID),
// customId dédié au canal de récupération. Champs toujours vides.
function recoveryTransferModal(t) {
  return {
    customId: Id.RECOVERY_TRANSFER_SUBMIT,
    title: t("ownerpanel.transferModalTitle"),
    fields: [
      { id: Field.TRANSFER_CODE, label: t("ownerpanel.transferCodeField"), value: "", required: true, style: "short" },
      { id: Field.NEW_OWNER_ID, label: t("ownerpanel.transferNewOwnerField"), value: "", required: true, style: "short" },
    ],
  };
}

function confirmView(t, {
  textKey,
  targetId,
  confirmId = Id.CONFIRM,
  cancelId = Id.CANCEL,
}) {
  return {
    title: t("ownerpanel.title"),
    content: t(textKey, { target: `<@${targetId}> (\`${targetId}\`)` }),
    components: [
      { type: "button", customId: confirmId, label: t("ownerpanel.confirm"), style: "danger" },
      { type: "button", customId: cancelId, label: t("ownerpanel.cancel"), style: "secondary" },
    ],
  };
}

function resultView(t, i18nKey) {
  return { title: t("ownerpanel.title"), content: t(i18nKey), components: [] };
}

module.exports = { masterModal, refusedView, panelView, addAdminModal, removeAdminModal, transferModal, recoveryView, recoveryTransferModal, confirmView, resultView };
