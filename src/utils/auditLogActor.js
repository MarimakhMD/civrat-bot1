"use strict";

/**
 * PHASE 1 — corrélation Audit Log fiable.
 *
 * RÈGLE : 1 action réelle = 1 attribution correcte, et jamais d'attribution
 * inventée. Trois gardes cumulatives remplacent l'ancienne lecture `limit: 1` :
 *
 *  1. CIBLE — l'entrée doit viser exactement le membre / le code attendu.
 *  2. NATURE — pour les entrées polymorphes (`MemberUpdate` couvre pseudo,
 *     avatar, boost ET timeout), les `changes` doivent réellement correspondre
 *     à l'action cherchée.
 *  3. TEMPORALITÉ + CONSOMMATION — l'entrée doit être contemporaine de
 *     l'événement, et une entrée déjà attribuée à un log ne peut plus être
 *     attribuée à un second.
 *
 * La garde 3 est celle qui règle le cas « kick → retour → départ volontaire » :
 * l'ancien `MemberKick` a déjà été consommé par le premier départ, il ne peut
 * donc plus transformer le second départ en expulsion. La fraîcheur couvre le
 * cas où le registre est vide (redémarrage du bot).
 */

const { fetchAuditLogEntries, readAuditLog } = require("./auditLogCache");
const { executorLabel } = require("../modules/logs/services/logLabels");

/** Âge maximal d'une entrée pour rester attribuable à un événement. */
const MAX_ENTRY_AGE_MS = 30_000;

/**
 * Tolérance d'horloge : une entrée peut être postérieure à l'événement.
 *
 * PHASE 1 (correctif 2) — passée de 10 s à 60 s.
 *
 * `entryTimestamp` vient de l'horloge de Discord, `occurredAt` de celle du
 * conteneur. Une dérive de plus de 10 s (courante sans NTP) faisait rejeter
 * TOUTES les entrées comme « trop récentes » : plus aucun log corrélé, sans
 * aucune trace.
 *
 * Cet élargissement ne rouvre PAS le risque d'attribuer une ancienne action :
 * la borne qui protège de cela est `MAX_ENTRY_AGE_MS` (côté passé), inchangée à
 * 30 s, renforcée par le registre d'entrées consommées. Verrouillé par
 * `test/phase1/audit-correlation-window.test.js` : un `MemberKick` de 5 min ne
 * peut toujours pas être réattribué.
 */
const CLOCK_SKEW_MS = 60_000;

/** Durée pendant laquelle une entrée consommée reste mémorisée. */
const CONSUMED_TTL_MS = 10 * 60 * 1000;

/** Plafond d'entrées mémorisées par `guildId:type` (bornage mémoire). */
const CONSUMED_MAX_PER_KEY = 500;

/** Clé de `changes` Discord correspondant à un timeout. */
const TIMEOUT_CHANGE_KEY = "communication_disabled_until";

/**
 * Valeurs numériques d'`AuditLogEvent` utilisées ici.
 *
 * Recopiées volontairement plutôt qu'importées depuis discord.js : ce module
 * est un utilitaire de chemin chaud, unit-testé sans charger discord.js. La
 * parité avec discord.js est verrouillée par un test dédié
 * (`src/utils/tests/auditLogActor.test.js`).
 */
const AuditLogEventType = Object.freeze({
  MEMBER_KICK: 20,
  MEMBER_BAN_ADD: 22,
  MEMBER_BAN_REMOVE: 23,
  MEMBER_UPDATE: 24,
  MEMBER_ROLE_UPDATE: 25,
});

/** `guildId:type` -> Map<entryId, expiresAt> */
const consumed = new Map();

function consumedKey(guildId, type) {
  return `${guildId}:${type}`;
}

function isConsumed(guildId, type, entry) {
  const id = entry && entry.id;
  if (!id) return false; // entrée sans identifiant (fixture) : non traçable
  const ledger = consumed.get(consumedKey(guildId, type));
  if (!ledger) return false;
  const expiresAt = ledger.get(String(id));
  if (expiresAt === undefined) return false;
  if (expiresAt <= Date.now()) {
    ledger.delete(String(id));
    return false;
  }
  return true;
}

function markConsumed(guildId, type, entry) {
  const id = entry && entry.id;
  if (!id) return;
  const key = consumedKey(guildId, type);
  const ledger = consumed.get(key) || new Map();
  const now = Date.now();

  // Purge des entrées expirées, puis bornage : on évite les plus anciennes.
  for (const [entryId, expiresAt] of ledger) {
    if (expiresAt <= now) ledger.delete(entryId);
  }
  while (ledger.size >= CONSUMED_MAX_PER_KEY) {
    const oldest = ledger.keys().next().value;
    if (oldest === undefined) break;
    ledger.delete(oldest);
  }

  ledger.set(String(id), now + CONSUMED_TTL_MS);
  consumed.set(key, ledger);
}

/** Test uniquement : vide le registre de consommation. */
function _resetConsumed() {
  consumed.clear();
}

function _getConsumed() {
  return consumed;
}

// ─────────────────────────────────────────────────────────────
// Gardes unitaires
// ─────────────────────────────────────────────────────────────

function entryTimestamp(entry) {
  if (!entry || typeof entry !== "object") return null;
  const raw = entry.createdAt !== undefined ? entry.createdAt : entry.createdTimestamp;
  if (raw === null || raw === undefined) return null;
  const timestamp = raw instanceof Date ? raw.getTime() : new Date(raw).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

/**
 * Fraîcheur : l'entrée doit être contemporaine de l'événement.
 *
 * Une entrée sans horodatage (fixture de test) ne peut pas être datée : la
 * garde est alors inapplicable et n'interdit rien. Discord fournit toujours
 * `createdAt` — cette branche ne sert qu'aux doubles de test.
 */
function isFresh(entry, occurredAt, maxAgeMs = MAX_ENTRY_AGE_MS) {
  const timestamp = entryTimestamp(entry);
  if (timestamp === null) return true;
  return timestamp >= occurredAt - maxAgeMs && timestamp <= occurredAt + CLOCK_SKEW_MS;
}

/**
 * Identifiant de la cible d'une entrée d'audit.
 *
 * PHASE 1 (correctif 4) — `entry.target` n'est PAS fiable.
 *
 * discord.js résout la cible d'une entrée `User` (tous les types < 30 : kick,
 * ban, pseudo, timeout, rôles) ainsi :
 *
 *   this.target = guild.client.options.partials.includes(Partials.User)
 *     ? guild.client.users._add({ id: data.target_id })
 *     : (guild.client.users.cache.get(data.target_id) ?? null);
 *
 * CIVRAT démarre avec `partials: [Message, Channel, GuildMember]` — SANS
 * `Partials.User`. Dès que l'utilisateur visé n'est pas déjà dans
 * `client.users.cache`, `entry.target` vaut donc **null** et toute corrélation
 * échouait en « NO_MATCHING_ENTRY » alors que l'entrée était bien présente.
 *
 * `entry.targetId` vient du payload brut (`data.target_id`) et est TOUJOURS
 * renseigné : c'est la seule base de comparaison fiable.
 */
function entryTargetId(entry) {
  if (!entry) return null;
  if (entry.targetId !== undefined && entry.targetId !== null) return String(entry.targetId);
  const target = entry.target;
  if (target && target.id !== undefined && target.id !== null) return String(target.id);
  return null;
}

/** Correspondance stricte de cible : par identifiant, ou par code (invitations). */
function matchesTarget(entry, targetId, targetCode) {
  if (targetCode !== null && targetCode !== undefined) {
    return Boolean(entry && entry.target && entry.target.code === targetCode);
  }
  if (targetId !== null && targetId !== undefined) {
    return entryTargetId(entry) === String(targetId);
  }
  return false;
}

/** Retrouve une clé précise dans `entry.changes`, ou `null`. */
function findChange(entry, key) {
  const changes = entry && entry.changes;
  if (!Array.isArray(changes)) return null;
  for (const change of changes) {
    if (change && change.key === key) return change;
  }
  return null;
}

function hasValue(value) {
  return value !== null && value !== undefined && value !== "" && value !== false;
}

/**
 * Sélectionne la première entrée (la plus récente) qui satisfait TOUTES les
 * gardes. `null` si aucune ne convient : rien n'est alors attribué.
 */
function pickEntry(entries, {
  guildId,
  type,
  targetId = null,
  targetCode = null,
  changeFilter = null,
  occurredAt,
  maxAgeMs = MAX_ENTRY_AGE_MS,
}) {
  for (const entry of entries) {
    if (!entry) continue;
    if (!matchesTarget(entry, targetId, targetCode)) continue;
    if (changeFilter && !changeFilter(entry)) continue;
    if (isConsumed(guildId, type, entry)) continue;
    if (!isFresh(entry, occurredAt, maxAgeMs)) continue;
    return entry;
  }
  return null;
}

function describe(entry) {
  if (!entry) return { matched: false, entry: null, executor: null, executorId: null, reason: null };
  const executor = entry.executor || null;
  return {
    matched: true,
    entry,
    executor: executorLabel(entry),
    executorId: executor ? executor.id : null,
    reason: entry.reason || null,
  };
}

/**
 * Résolution complète : renvoie aussi `matched` et `entry`, ce qui permet à
 * l'appelant de distinguer « aucune action de ce type » de « action sans
 * exécutant identifié » — distinction indispensable pour ne plus journaliser
 * une expulsion fantôme à chaque départ volontaire.
 */
async function resolveAuditAction({
  guild,
  type,
  targetId = null,
  targetCode = null,
  changeFilter = null,
  occurredAt = Date.now(),
  maxAgeMs = MAX_ENTRY_AGE_MS,
  consume = true,
}) {
  if (!guild || (!targetId && !targetCode)) {
    return { matched: false, entry: null, executor: null, executorId: null, reason: null };
  }

  const entries = await fetchAuditLogEntries(guild, type);
  const entry = pickEntry(entries, {
    guildId: guild.id,
    type,
    targetId,
    targetCode,
    changeFilter,
    occurredAt,
    maxAgeMs,
  });

  if (!entry) {
    return { matched: false, entry: null, executor: null, executorId: null, reason: null };
  }

  if (consume) markConsumed(guild.id, type, entry);
  return describe(entry);
}

/**
 * Rétrocompatible : exécutant / id / raison, `null` si aucune entrée ne
 * correspond strictement. Aucune identité n'est inventée.
 */
async function resolveAuditActor(options) {
  const result = await resolveAuditAction(options);
  return { executor: result.executor, executorId: result.executorId, reason: result.reason };
}

// ─────────────────────────────────────────────────────────────
// Timeout / UnTimeout — `MemberUpdate` est polymorphe
// ─────────────────────────────────────────────────────────────

/** L'entrée porte-t-elle réellement la POSE d'un timeout ? */
function isTimeoutEntry(entry) {
  const change = findChange(entry, TIMEOUT_CHANGE_KEY);
  if (!change) return false;
  return hasValue(change.new);
}

/** L'entrée porte-t-elle réellement la LEVÉE d'un timeout ? */
function isUntimeoutEntry(entry) {
  const change = findChange(entry, TIMEOUT_CHANGE_KEY);
  if (!change) return false;
  return !hasValue(change.new) && hasValue(change.old);
}

/**
 * Résout l'auteur et la raison d'un timeout / untimeout.
 *
 * `MemberUpdate` couvre aussi les changements de pseudo, d'avatar et de boost :
 * sans filtre sur `changes`, une entrée de renommage était attribuée au
 * timeout. Le filtre `communication_disabled_until` supprime cette confusion.
 */
async function resolveTimeoutAction({ guild, memberId, action, occurredAt = Date.now(), maxAgeMs = MAX_ENTRY_AGE_MS }) {
  const changeFilter = action === "member_untimeout" ? isUntimeoutEntry : isTimeoutEntry;
  return resolveAuditAction({
    guild,
    type: AuditLogEventType.MEMBER_UPDATE,
    targetId: memberId,
    changeFilter,
    occurredAt,
    maxAgeMs,
  });
}

// ─────────────────────────────────────────────────────────────
// Rôles — delta autoritaire ($add / $remove)
// ─────────────────────────────────────────────────────────────

/**
 * Extrait le delta de rôles d'une entrée `MemberRoleUpdate` depuis ses
 * `changes` (`$add` / `$remove`). C'est la source d'autorité : la différence de
 * caches `guildMemberUpdate` est fragile (membre partiel → caches vides → tous
 * les rôles apparaissent comme ajoutés).
 */
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

function hasRoleDelta(entry) {
  const { added, removed } = roleDelta(entry && entry.changes);
  return added.length > 0 || removed.length > 0;
}

function describeRoleDelta(entry) {
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

/**
 * Rétrocompatible : delta de la seule entrée la plus récente.
 * Préférer `resolveRoleDeltas`, qui sépare les changements rapprochés.
 */
async function resolveRoleDelta({ guild, type, memberId, occurredAt = Date.now(), maxAgeMs = MAX_ENTRY_AGE_MS }) {
  if (!guild || !memberId) {
    return { addedRoles: [], removedRoles: [], executor: null, executorId: null, reason: null };
  }
  const entries = await fetchAuditLogEntries(guild, type);
  const entry = pickEntry(entries, {
    guildId: guild.id,
    type,
    targetId: memberId,
    changeFilter: hasRoleDelta,
    occurredAt,
    maxAgeMs,
  });
  if (entry) markConsumed(guild.id, type, entry);
  return describeRoleDelta(entry);
}

/**
 * Tous les changements de rôles attribuables à CE membre, du plus ancien au
 * plus récent, chacun consommé une seule fois — avec l'état de la lecture.
 *
 * C'est ce qui rend corrects les deux scénarios de concurrence :
 *  • plusieurs membres modifiés dans la même fenêtre → chacun reçoit SES
 *    entrées, plus de perte par écrasement de cache ;
 *  • plusieurs modifications du même membre → un log par modification, au lieu
 *    d'un seul log rejoué ou d'un delta fusionné à tort.
 *
 * `available: false` signifie que l'Audit Log était ILLISIBLE (permission
 * manquante, rate limit) : `deltas` est vide et rien n'est inventé, mais
 * l'appelant peut produire un diagnostic au lieu de se taire. `reason`
 * différencie ce cas d'une liste réellement vide (`NO_MATCHING_ENTRY` est alors
 * laissé à l'appelant).
 *
 * @returns {Promise<{deltas: object[], available: boolean, reason: string|null,
 *   examined: number}>}
 */
async function resolveRoleDeltasDetailed({ guild, type, memberId, occurredAt = Date.now(), maxAgeMs = MAX_ENTRY_AGE_MS }) {
  if (!guild || !memberId) {
    return { deltas: [], available: false, reason: "TARGET_UNAVAILABLE", examined: 0 };
  }

  const { entries, available, reason } = await readAuditLog(guild, type);
  const selected = [];

  for (const entry of entries) {
    if (!entry) continue;
    if (!matchesTarget(entry, memberId, null)) continue;
    if (!hasRoleDelta(entry)) continue;
    if (isConsumed(guild.id, type, entry)) continue;
    if (!isFresh(entry, occurredAt, maxAgeMs)) continue;
    selected.push(entry);
  }

  // `readAuditLog` rend les entrées de la plus récente à la plus ancienne :
  // on inverse pour journaliser dans l'ordre chronologique réel.
  selected.reverse();

  for (const entry of selected) markConsumed(guild.id, type, entry);
  return {
    deltas: selected.map((entry) => ({ ...describeRoleDelta(entry), entryId: entry.id || null })),
    available,
    reason,
    examined: entries.length,
  };
}

/**
 * Rétrocompatible : seuls les deltas. Préférer `resolveRoleDeltasDetailed`,
 * qui distingue « Audit Log illisible » d'« aucune entrée correspondante ».
 */
async function resolveRoleDeltas(options) {
  const result = await resolveRoleDeltasDetailed(options);
  return result.deltas;
}

module.exports = {
  resolveAuditActor,
  resolveAuditAction,
  resolveTimeoutAction,
  resolveRoleDelta,
  resolveRoleDeltas,
  resolveRoleDeltasDetailed,
  roleDelta,
  isTimeoutEntry,
  isUntimeoutEntry,
  findChange,
  matchesTarget,
  entryTargetId,
  isFresh,
  entryTimestamp,
  _resetConsumed,
  _getConsumed,
  MAX_ENTRY_AGE_MS,
  CLOCK_SKEW_MS,
  TIMEOUT_CHANGE_KEY,
  AuditLogEventType,
};
