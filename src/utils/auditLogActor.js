"use strict";

const { fetchAuditLog } = require("./auditLogCache");
const { executorLabel } = require("../modules/logs/services/logLabels");

// Résout l'exécutant et la raison d'une entrée d'audit, avec une garde de
// correspondance STRICTE. On ne retourne un exécutant que si l'entrée existe
// ET vise bien la cible attendue (par id, ou par code pour les invitations).
// Sinon `null` — aucune identité n'est inventée.
//
// `type` est une valeur d'AuditLogEvent (nombre). `targetId`/`targetCode`
// identifient la cible à vérifier ; l'un des deux doit être fourni.
async function resolveAuditActor({ guild, type, targetId = null, targetCode = null }) {
  if (!guild || (!targetId && !targetCode)) {
    return { executor: null, executorId: null, reason: null };
  }

  const entry = await fetchAuditLog(guild, type);
  if (!entry) return { executor: null, executorId: null, reason: null };

  if (targetCode !== null && targetCode !== undefined) {
    // Invitations : la cible est identifiée par son code.
    const code = entry.target && entry.target.code;
    if (code !== targetCode) return { executor: null, executorId: null, reason: null };
  } else if (targetId !== null && targetId !== undefined) {
    if (!entry.target || entry.target.id !== targetId) {
      // L'entrée (éventuellement servie par le cache 3 s) concerne une autre
      // cible : on refuse plutôt que d'attribuer une action à la mauvaise personne.
      return { executor: null, executorId: null, reason: null };
    }
  }

  const executor = entry.executor || null;
  return {
    executor: executorLabel(entry),
    executorId: executor ? executor.id : null,
    reason: entry.reason || null,
  };
}

module.exports = { resolveAuditActor };
