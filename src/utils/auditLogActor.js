"use strict";

const { fetchAuditLog } = require("./auditLogCache");
const { executorLabel } = require("../modules/logs/services/logLabels");

// Récupère l'entrée d'audit la plus récente du type demandé, UNIQUEMENT si
// elle vise bien la cible attendue (par id, ou par code pour les invitations).
// Sinon `null` — aucune action n'est attribuée à la mauvaise personne.
async function fetchMatchedEntry(guild, { type, targetId = null, targetCode = null }) {
  if (!guild || (!targetId && !targetCode)) return null;

  const entry = await fetchAuditLog(guild, type);
  if (!entry) return null;

  if (targetCode !== null && targetCode !== undefined) {
    // Invitations : la cible est identifiée par son code.
    const code = entry.target && entry.target.code;
    if (code !== targetCode) return null;
  } else if (targetId !== null && targetId !== undefined) {
    if (!entry.target || entry.target.id !== targetId) return null;
  }

  return entry;
}

// Résout l'exécutant et la raison d'une entrée d'audit, avec une garde de
// correspondance STRICTE. On ne retourne un exécutant que si l'entrée existe
// ET vise bien la cible attendue (par id, ou par code pour les invitations).
// Sinon `null` — aucune identité n'est inventée.
//
// `type` est une valeur d'AuditLogEvent (nombre). `targetId`/`targetCode`
// identifient la cible à vérifier ; l'un des deux doit être fourni.
async function resolveAuditActor({ guild, type, targetId = null, targetCode = null }) {
  const entry = await fetchMatchedEntry(guild, { type, targetId, targetCode });
  if (!entry) return { executor: null, executorId: null, reason: null };

  const executor = entry.executor || null;
  return {
    executor: executorLabel(entry),
    executorId: executor ? executor.id : null,
    reason: entry.reason || null,
  };
}

// Extrait le delta de rôles d'une entrée d'audit MemberRoleUpdate à partir de
// ses `changes` (clés `$add` et `$remove`). C'est la source d'autorité : la
// différence de caches guildMemberUpdate est fragile (membre partiel → caches
// vides → tous les rôles apparaissent comme ajoutés).
function roleDelta(changes) {
  const added = [];
  const removed = [];
  if (Array.isArray(changes)) {
    for (const change of changes) {
      if (!change) continue;
      if (change.key === "$add" && Array.isArray(change.new)) added.push(...change.new);
      else if (change.key === "$remove" && Array.isArray(change.new)) removed.push(...change.new);
    }
  }
  return { added, removed };
}

// Résout l'exécutant, la raison et le delta de rôles (ajoutés / retirés) pour
// une modification de rôles d'un membre, avec correspondance stricte sur la
// cible. Si l'entrée d'audit est absente, les listes sont vides : on ne
// journalise rien plutôt que d'inventer un delta.
async function resolveRoleDelta({ guild, type, memberId }) {
  const entry = await fetchMatchedEntry(guild, { type, targetId: memberId });
  if (!entry) {
    return { addedRoles: [], removedRoles: [], executor: null, executorId: null, reason: null };
  }

  const { added, removed } = roleDelta(entry.changes);
  const executor = entry.executor || null;
  return {
    addedRoles: added,
    removedRoles: removed,
    executor: executorLabel(entry),
    executorId: executor ? executor.id : null,
    reason: entry.reason || null,
  };
}

module.exports = { resolveAuditActor, resolveRoleDelta, roleDelta };
