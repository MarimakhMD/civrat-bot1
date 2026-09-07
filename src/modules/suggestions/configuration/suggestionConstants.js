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
// C2 — Les clés ci-dessous sont les NOMS RÉELS des colonnes de guild_configs,
// vérifiés dans le schéma Supabase. Les anciens noms au singulier
// (« suggestion_enabled », « suggestion_channel_id ») n'existent pas en base :
//   • service.update() envoyait un payload contenant une colonne inconnue,
//     donc PostgREST REJETAIT l'upsert entier — le toggle /settings ne
//     persistait jamais, et faisait échouer au passage les réglages des autres
//     modules écrits dans le même appel ;
//   • SuggestionService lisait config.suggestion_enabled, toujours undefined,
//     donc /suggest répondait SUGGESTION_DISABLED même une fois activé.
// Aucune colonne n'est créée ni renommée en base : le code s'aligne sur l'existant.
const SuggestionConfigKey = Object.freeze({
  ENABLED: "suggestions_enabled",
  CHANNEL_ID: "suggestions_channel_id",
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
  suggestions_enabled: false,
  suggestions_channel_id: null,
});

const SuggestionStatus = Object.freeze({
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
  DELETED: "deleted",
});

module.exports = { SuggestionConfigKey, SuggestionComponentId, SUGGESTION_DEFAULTS, SuggestionStatus };
