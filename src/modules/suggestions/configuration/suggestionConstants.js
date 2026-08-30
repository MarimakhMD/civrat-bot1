"use strict";

// Phase 1 (C12) : deux constantes mortes ont été retirées —
//   • SuggestionConfigKey.APPROVAL_REQUIRED (« suggestion_approval_required »)
//   • SuggestionComponentId.APPROVAL (« civrat:v1:suggestion:approval »)
// Aucune n'était lue ni écrite par le moindre service, vue ou route : la
// colonne restait figée à sa valeur par défaut et le customId n'était rendu
// par aucun composant (absent du registre d'interactions). Les conserver
// laissait croire à une modération à approbation configurable qui n'existe
// pas. Le flux réel d'approbation passe par les boutons
// suggestion_approve / suggestion_reject / suggestion_delete.
const SuggestionConfigKey = Object.freeze({
  ENABLED: "suggestion_enabled",
  CHANNEL_ID: "suggestion_channel_id",
});

const SuggestionComponentId = Object.freeze({
  SECTION: "civrat:v1:suggestion:section",
  TOGGLE: "civrat:v1:suggestion:toggle",
  CHANNEL: "civrat:v1:suggestion:channel",
  BACK: "civrat:v1:suggestion:back",
  VOTE_UP: "suggestion_up",
  VOTE_DOWN: "suggestion_down",
  APPROVE: "suggestion_approve",
  REJECT: "suggestion_reject",
  DELETE: "suggestion_delete",
});

const SUGGESTION_DEFAULTS = Object.freeze({
  suggestion_enabled: false,
  suggestion_channel_id: null,
});

const SuggestionStatus = Object.freeze({
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
  DELETED: "deleted",
});

module.exports = { SuggestionConfigKey, SuggestionComponentId, SUGGESTION_DEFAULTS, SuggestionStatus };
