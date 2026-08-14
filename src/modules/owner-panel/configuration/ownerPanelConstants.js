"use strict";

// P20 — constantes du Owner Panel CIVRAT.
// Aucune valeur secrète ici : uniquement des ids de composants, des noms de
// champs et des limites de politique de sécurité (non secrètes).

const OwnerPanelComponentId = Object.freeze({
  MASTER_SUBMIT: "civrat:v1:ownerpanel:master:submit",
  ADD_ADMIN: "civrat:v1:ownerpanel:admin:add",
  REMOVE_ADMIN: "civrat:v1:ownerpanel:admin:remove",
  TRANSFER: "civrat:v1:ownerpanel:transfer",
  ADD_ADMIN_SUBMIT: "civrat:v1:ownerpanel:admin:add:submit",
  REMOVE_ADMIN_SUBMIT: "civrat:v1:ownerpanel:admin:remove:submit",
  TRANSFER_SUBMIT: "civrat:v1:ownerpanel:transfer:submit",
  CONFIRM: "civrat:v1:ownerpanel:confirm",
  CANCEL: "civrat:v1:ownerpanel:cancel",
  // P20.1 — canal de récupération (élévation Recovery active requise, garde
  // applicative dans chaque handler ; CIVRAT_OWNER n'y est jamais impliqué).
  RECOVERY_MASTER: "civrat:v1:ownerpanel:recovery:master",
  RECOVERY_TRANSFER: "civrat:v1:ownerpanel:recovery:transfer",
  RECOVERY_TRANSFER_SUBMIT: "civrat:v1:ownerpanel:recovery:transfer:submit",
  RECOVERY_CONFIRM: "civrat:v1:ownerpanel:recovery:confirm",
  RECOVERY_CANCEL: "civrat:v1:ownerpanel:recovery:cancel",
});

const OwnerPanelFieldId = Object.freeze({
  MASTER: "owner_panel_master_code",
  TARGET_ID: "target_discord_id",
  TRANSFER_CODE: "owner_transfer_code",
  NEW_OWNER_ID: "new_owner_discord_id",
});

// Limites de politique (valeurs NON secrètes) :
const OwnerPanelPolicy = Object.freeze({
  SESSION_TTL_MS: 10 * 60 * 1000, // session courte (accès lecture non-Owner via Master Code)
  // V1 — l'Owner authentifié obtient une session de 24 h ; les Admins CIVRAT
  // n'ont AUCUNE session (accès lié au statut Admin persistant, sans code ni
  // expiration). L'expiration d'une session ne touche jamais le statut Owner.
  OWNER_SESSION_TTL_MS: 24 * 60 * 60 * 1000, // session Owner = 24 heures
  MAX_MASTER_FAILURES: 5, // mauvais codes consécutifs avant verrouillage
  LOCK_TTL_MS: 5 * 60 * 1000, // durée du verrouillage anti force brute
  PENDING_TTL_MS: 10 * 60 * 1000, // durée de vie d'une action en attente de confirmation
  DISCORD_ID_PATTERN: /^\d{16,20}$/, // forme d'un identifiant Discord (snowflake)
});

// Types des actions en attente de confirmation explicite.
const PendingActionType = Object.freeze({
  ADD_ADMIN: "ADD_ADMIN",
  REMOVE_ADMIN: "REMOVE_ADMIN",
  TRANSFER_OWNER: "TRANSFER_OWNER",
  // P20.1 — transfert initié par élévation Recovery (canal dédié).
  RECOVERY_TRANSFER: "RECOVERY_TRANSFER",
});

module.exports = { OwnerPanelComponentId, OwnerPanelFieldId, OwnerPanelPolicy, PendingActionType };
