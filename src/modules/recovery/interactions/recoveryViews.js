"use strict";

const { RecoveryComponentId: Id, RecoveryFieldId: Field } = require("../configuration/recoveryConstants");

// P20 — vues du flux de récupération. Tout le texte passe par l'i18n du
// module (EN/FR, parité vérifiée). Aucune valeur saisie (Master Code, code
// temporaire) n'est jamais réaffichée : les modales sont vides à l'ouverture
// et toutes les réponses sont éphémères et génériques.

function masterModal(t) {
  return {
    customId: Id.MASTER_SUBMIT,
    title: t("recovery.masterModalTitle"),
    fields: [{ id: Field.MASTER, label: t("recovery.masterField"), value: "", required: true, style: "short" }],
  };
}

function enterCodeReplyView(t) {
  // Ne confirme rien sur la validité du Master Code : message générique +
  // bouton de saisie du code reçu par e-mail.
  return {
    title: t("recovery.title"),
    content: t("recovery.requestReceived"),
    components: [{ type: "button", customId: Id.ENTER_CODE, label: t("recovery.enterCode"), style: "primary" }],
  };
}

function codeModal(t) {
  return {
    customId: Id.CODE_SUBMIT,
    title: t("recovery.codeModalTitle"),
    fields: [{ id: Field.TEMP_CODE, label: t("recovery.codeField"), value: "", required: true, style: "short" }],
  };
}

function resultReplyView(t, i18nKey) {
  return { title: t("recovery.title"), content: t(i18nKey), components: [] };
}

module.exports = { masterModal, enterCodeReplyView, codeModal, resultReplyView };
