"use strict";

// P20 — constantes du système de récupération propriétaire.
// Aucune valeur secrète ici : uniquement des ids de composants et des limites
// de politique de sécurité.

const RecoveryComponentId = Object.freeze({
  ENTER_CODE: "civrat:v1:recovery:enter-code",
  MASTER_SUBMIT: "civrat:v1:recovery:master:submit",
  CODE_SUBMIT: "civrat:v1:recovery:code:submit",
});

const RecoveryFieldId = Object.freeze({
  MASTER: "master_code",
  TEMP_CODE: "temp_code",
});

// Limites de politique (valeurs NON secrètes, ajustables par le owner en
// connaissance de cause) :
const RecoveryPolicy = Object.freeze({
  CODE_TTL_MS: 10 * 60 * 1000, // expiration courte du code temporaire
  CODE_LENGTH: 6, // code à 6 chiffres (crypto.randomInt)
  MAX_VERIFY_ATTEMPTS: 5, // au-delà : code invalidé définitivement
  REQUEST_COOLDOWN_MS: 60 * 1000, // anti-spam de demandes d'e-mail (par utilisateur)
  // Fenêtre d'élévation après vérification réussie. COUTURE UNIQUEMENT :
  // rien ne la consomme en V1 tant que la décision produit sur le privilège
  // final n'est pas prise (cf. rapport P20 — options d'identité).
  ELEVATION_WINDOW_MS: 15 * 60 * 1000,
});

module.exports = { RecoveryComponentId, RecoveryFieldId, RecoveryPolicy };
