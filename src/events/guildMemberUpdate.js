// ═══════════════════════════════════════════════════
// EVENT: guildMemberUpdate - Roles, Nickname, Timeout
// ═══════════════════════════════════════════════════
// PHASE 1 — chaque modification réelle produit exactement un log, corrélé à la
// bonne entrée d'audit.
//
// Trois défauts corrigés en Phase 1 :
//  • la branche rôles tournait sur CHAQUE guildMemberUpdate (pseudo, timeout,
//    boost compris), relisant l'audit et REJOUANT le dernier delta de rôles ;
//  • `limit: 1` + cache 3 s faisait perdre les changements sous concurrence ;
//  • le timeout acceptait N'IMPORTE QUELLE entrée `MemberUpdate` (pseudo,
//    avatar, boost) : l'auteur et la raison d'un renommage étaient attribués au
//    timeout.
//
// PHASE 1 (correctif 1) — ÉTAT FIGÉ AVANT TOUT AWAIT.
//
// discord.js émet `guildMemberUpdate(old, member)` où `old` est un CLONE et
// `member` est l'objet VIVANT du cache de la guilde. Toute entrée gateway
// suivante applique un nouveau `_patch` à ce même objet.
//
// L'ancienne version calculait `nicknameChanged` et `timeoutChanged` APRÈS
// `await guildConfigService.getGuildConfig(...)`, puis relisait encore ces
// objets vivants 1000 ms plus tard, après le délai laissé à l'Audit Log. Deux
// conséquences mesurées :
//   • un ajout de rôle SEUL pouvait produire un `member_nickname_changed`
//     fantôme dès qu'un autre `GUILD_MEMBER_UPDATE` du même membre arrivait
//     pendant la lecture en base ;
//   • un log de pseudo légitime pouvait afficher une valeur « Après » qui
//     n'était pas celle de l'événement, mais une modification ultérieure.
//
// Désormais, tout l'état de l'événement (pseudo avant/après, timeout
// avant/après, identité et delta de rôles) est capturé de façon synchrone
// AVANT le premier `await`. Aucune branche ne relit `oldMember` / `newMember`
// après coup : chaque événement journalise SON état, jamais celui d'un
// événement ultérieur.

const guildConfigService = require("../services/guildConfig");
const { resolveTimeoutAction, resolveRoleDeltasDetailed, AuditLogEventType } = require("../utils/auditLogActor");
const { consumeSelfAction } = require("../utils/selfActionRegistry");
const { memberDisplayLabel, roleLabel, avatarUrl, formatDuration } = require("../modules/logs/services/logLabels");
const { resolveLanguage } = require("../modules/logs/services/logLanguage");
const logger = require("../utils/logger");

/** Délai laissé à Discord pour écrire l'entrée d'audit avant de la lire. */
const AUDIT_SETTLE_DELAY_MS = 1000;

module.exports = {
  name: "guildMemberUpdate",
  once: false,

  async execute(oldMember, newMember) {
    // Référence temporelle capturée AVANT tout `await` : elle borne l'âge des
    // entrées d'audit attribuables, malgré le délai d'attente ci-dessous.
    const occurredAt = Date.now();

    // 1) ÉTAT FIGÉ — synchrone, avant tout `await`.
    //    `newMember` est l'objet VIVANT du cache : le lire après un `await`
    //    reviendrait à journaliser un événement qui n'est pas celui-ci.
    const event = captureMemberUpdate(oldMember, newMember);

    // Aucune des trois modifications → aucun log, et surtout AUCUNE lecture
    // d'Audit Log ni de configuration (guildMemberUpdate se déclenche aussi
    // pour des changements qui ne nous concernent pas : avatar, boost,
    // présence…).
    if (!event.rolesChanged && !event.nicknameChanged && !event.timeoutChanged) return;

    const config = await guildConfigService.getGuildConfig(newMember.guild.id);
    if (!config?.logs_enabled) return;

    // 2) Les trois branches ne consomment QUE `event` et la guilde (identité
    //    stable). Aucun `oldMember` / `newMember` n'est relu ici.
    if (event.rolesChanged) await handleRoleChanges(event, newMember.guild, config, occurredAt);
    if (event.nicknameChanged) await handleNicknameChange(event, newMember.guild, config);
    if (event.timeoutChanged) await handleTimeout(event, newMember.guild, config, occurredAt);
  },

  // Couture de test sur la capture d'état : c'est elle qui garantit qu'un
  // changement de rôle seul ne peut pas produire de log de pseudo.
  captureMemberUpdate,
  AUDIT_SETTLE_DELAY_MS,
};

// ─────────────────────────────────────────────────────────────
// Capture d'état
// ─────────────────────────────────────────────────────────────

/**
 * `undefined`, `null` et `""` désignent la même réalité : « pas de pseudo ».
 * Les comparer bruts faisait de `undefined !== null` un faux changement.
 */
function normalizeNickname(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Un horodatage absent ou invalide vaut `null`, jamais `0` ni `NaN`. */
function normalizeTimestamp(value) {
  return Number.isFinite(value) ? value : null;
}

/**
 * PHASE 1 (correctif 4) — l'état « avant » est-il fiable ?
 *
 * CIVRAT démarre avec `Partials.GuildMember` : un membre peut entrer en cache
 * depuis un payload partiel (réaction, thread, voix) qui ne porte NI `nick` NI
 * `communication_disabled_until`. `GuildMember` initialise alors ces champs à
 * `null` — un défaut de constructeur, pas la valeur réelle.
 *
 * Conséquence mesurée avec discord.js 14.27 : un membre partiel dont le vrai
 * pseudo est « Alice », à qui l'on ajoute UNIQUEMENT un rôle, produit
 * `oldMember.nickname === null` puis `newMember.nickname === "Alice"` →
 * faux log « Pseudo modifié ».
 *
 * `GuildMember#partial` (`joinedTimestamp === null`) est le marqueur exact de
 * cet état. Quand il est vrai, on ne sait PAS ce qui a changé : on ne journalise
 * ni pseudo ni timeout — jamais de donnée inventée. Le delta de rôles, lui,
 * passe par l'Audit Log, qui reste autoritaire.
 *
 * Les doubles de test qui ne modélisent pas `partial` ne sont pas considérés
 * comme partiels : seul `partial === true` (valeur discord.js) déclenche la garde.
 */
function isPartialMember(member) {
  return Boolean(member && member.partial === true);
}

/**
 * Fige l'intégralité de l'état de l'événement, de façon synchrone.
 *
 * @returns {Readonly<{memberId:string|null, memberLabel:string|null,
 *   memberAvatarUrl:string|null, beforeNickname:string|null,
 *   afterNickname:string|null, nicknameChanged:boolean,
 *   beforeTimeout:number|null, afterTimeout:number|null,
 *   timeoutChanged:boolean, rolesChanged:boolean}>}
 */
function captureMemberUpdate(oldMember, newMember) {
  const beforeNickname = normalizeNickname(oldMember && oldMember.nickname);
  const afterNickname = normalizeNickname(newMember && newMember.nickname);
  const beforeTimeout = normalizeTimestamp(oldMember && oldMember.communicationDisabledUntilTimestamp);
  const afterTimeout = normalizeTimestamp(newMember && newMember.communicationDisabledUntilTimestamp);

  // Correctif 4 — sur un membre partiel, les champs « avant » sont des défauts
  // de constructeur : toute comparaison produirait un faux changement.
  const beforeReliable = !isPartialMember(oldMember);

  return Object.freeze({
    memberId: (newMember && newMember.id) || (oldMember && oldMember.id) || null,
    // Libellés et avatar résolus MAINTENANT : ce sont des valeurs de l'événement.
    memberLabel: memberDisplayLabel(newMember),
    memberAvatarUrl: avatarUrl(newMember),
    beforeReliable,
    beforeNickname,
    afterNickname,
    nicknameChanged: beforeReliable && beforeNickname !== afterNickname,
    beforeTimeout,
    afterTimeout,
    timeoutChanged: beforeReliable && beforeTimeout !== afterTimeout,
    // Les rôles ne dépendent pas du cache « avant » : la voie Audit Log est
    // autoritaire, y compris sur membre partiel.
    rolesChanged: roleSetChanged(oldMember, newMember),
  });
}

/**
 * Les rôles ont-ils réellement changé ?
 *
 * Comparaison volontairement prudente : si l'un des caches est absent ou vide
 * (membre partiel), on ne conclut PAS à l'absence de changement et on laisse la
 * voie Audit Log trancher. Seule l'égalité de deux caches non vides permet
 * d'écarter sans risque.
 */
function roleSetChanged(oldMember, newMember) {
  const before = oldMember && oldMember.roles && oldMember.roles.cache;
  const after = newMember && newMember.roles && newMember.roles.cache;
  if (!before || !after || before.size === 0 || after.size === 0) return true;
  if (before.size !== after.size) return true;
  for (const roleId of after.keys()) {
    if (!before.has(roleId)) return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────
// Branches
// ─────────────────────────────────────────────────────────────

async function handleRoleChanges(event, guild, config, occurredAt) {
  // Laisse Discord écrire l'entrée d'audit : le delta est lu depuis l'audit log,
  // PAS depuis la différence de caches — fragile sur membre partiel (caches
  // vides → tous les rôles apparaissent comme « ajoutés »).
  await new Promise((resolve) => setTimeout(resolve, AUDIT_SETTLE_DELAY_MS));

  // Toutes les entrées attribuables à CE membre, chacune consommée une seule
  // fois : plusieurs changements rapprochés donnent plusieurs logs distincts,
  // et un membre voisin modifié au même moment ne peut plus écraser le résultat.
  //
  // `available` distingue « l'Audit Log est illisible » (permission « Voir les
  // logs d'audit » absente, rate limit) de « aucune entrée ne correspond » :
  // dans les deux cas on n'invente rien, mais le motif est journalisé.
  const { deltas, available, reason } = await resolveRoleDeltasDetailed({
    guild,
    type: AuditLogEventType.MEMBER_ROLE_UPDATE,
    memberId: event.memberId,
    occurredAt,
  });

  if (deltas.length === 0) {
    // Rien n'est inventé. Le diagnostic reste émis quand la lecture a échoué
    // (permission manquante, rate limit) ou quand l'état « avant » était
    // fiable — donc qu'un vrai changement de rôles a bien eu lieu.
    //
    // Sur un membre PARTIEL dont l'état « avant » est inconnu, l'arrivée du
    // premier payload complet fait passer `_roles` de [] à la liste réelle :
    // le delta de caches signale un changement alors qu'aucun rôle n'a été
    // attribué. Ce cas n'est pas une anomalie, on ne le journalise pas.
    if (!available || event.beforeReliable) {
      logger.warn("Member role change could not be correlated to the audit log", {
        event: "LOG_ROLE_DELTA_UNRESOLVED",
        guildId: guild.id,
        memberId: event.memberId,
        auditAvailable: available,
        reason: reason || "NO_MATCHING_ENTRY",
      });
    }
    return;
  }

  const logsRuntime = require("../modules/logs/runtime/getLogsRuntime").getLogsRuntime();

  for (const delta of deltas) {
    for (const role of delta.addedRoles) {
      if (!role || !role.id) continue;
      await logsRuntime.handleRoleEvent({
        guild,
        config,
        action: "member_role_added",
        roleId: role.id,
        memberId: event.memberId,
        target: roleLabel(role),
        member: event.memberLabel,
        who: delta.executor,
        avatarUrl: event.memberAvatarUrl,
      });
    }

    for (const role of delta.removedRoles) {
      if (!role || !role.id) continue;
      await logsRuntime.handleRoleEvent({
        guild,
        config,
        action: "member_role_removed",
        roleId: role.id,
        memberId: event.memberId,
        target: roleLabel(role),
        member: event.memberLabel,
        who: delta.executor,
        avatarUrl: event.memberAvatarUrl,
      });
    }
  }
}

async function handleNicknameChange(event, guild, config) {
  await require("../modules/logs/runtime/getLogsRuntime").getLogsRuntime().handleMemberNicknameChanged({
    guild,
    config,
    memberId: event.memberId,
    member: event.memberLabel,
    before: event.beforeNickname,
    after: event.afterNickname,
    avatarUrl: event.memberAvatarUrl,
  });
}

async function handleTimeout(event, guild, config, occurredAt) {
  const action = event.beforeTimeout === null && event.afterTimeout !== null
    ? "member_timed_out"
    : event.beforeTimeout !== null && event.afterTimeout === null
      ? "member_untimeout"
      : null;

  // PHASE 1 (correctif 5) — AUCUN CHEMIN SILENCIEUX.
  //
  // Le timeout était la seule des trois branches à pouvoir disparaître sans
  // laisser de trace : les trois `return` ci-dessous sortaient sans log NI
  // diagnostic. Sur Discord réel, un timeout appliqué ne produisait rien et
  // rien n'indiquait pourquoi. Chaque sortie est désormais tracée, au niveau
  // adapté à sa nature : `warn` pour un cas non résolu, `info` pour un cas
  // attendu et déjà couvert ailleurs.

  if (!action) {
    // `communication_disabled_until` a changé sans pose ni levée nette : une
    // durée prolongée ou raccourcie. Rien n'est inventé, mais on ne se tait pas.
    logger.warn("Member timeout event ignored: no explicit timeout transition", {
      event: "LOG_TIMEOUT_TRANSITION_UNKNOWN",
      guildId: guild.id,
      memberId: event.memberId,
      beforeTimeout: event.beforeTimeout,
      afterTimeout: event.afterTimeout,
    });
    return;
  }

  // PHASE 1 — déduplication : un timeout appliqué par AutoMod a déjà produit
  // son log métier (`automod`, avec la règle violée). L'événement Discord qui
  // en découle n'est pas une seconde action : on ne le rejoue pas. Ce n'est pas
  // une anomalie → `info`, pas `warn`.
  if (consumeSelfAction("timeout", guild.id, event.memberId)) {
    logger.info("Member timeout event skipped: applied by the bot", {
      event: "LOG_TIMEOUT_SELF_ACTION",
      guildId: guild.id,
      memberId: event.memberId,
      action,
    });
    return;
  }

  // Exécutant/raison résolus sur une entrée dont les `changes` portent
  // réellement `communication_disabled_until`. Sans ce filtre, une entrée de
  // pseudo / avatar / boost du même membre était attribuée au timeout.
  const actor = await resolveTimeoutAction({
    guild,
    memberId: event.memberId,
    action,
    occurredAt,
  });

  // Le timeout a BIEN eu lieu — c'est l'événement gateway qui le dit. L'absence
  // d'entrée d'audit ne retire que l'auteur et la raison : le log part, avec
  // `who` à « inconnu », et le motif est journalisé. Une lecture d'Audit Log
  // impossible (permission, rate limit) est déjà signalée par
  // `AUDIT_LOG_READ_FAILED` dans `auditLogCache.js`.
  if (!actor.matched) {
    logger.warn("Member timeout could not be correlated to the audit log", {
      event: "LOG_TIMEOUT_UNRESOLVED",
      guildId: guild.id,
      memberId: event.memberId,
      action,
      reason: "NO_MATCHING_ENTRY",
    });
  }

  // Durée : différence entre l'échéance du timeout (celle de CET événement) et
  // l'instant présent, uniquement lorsque le membre vient d'être timeouté.
  // Jamais inventée, et localisée selon la langue de la guilde.
  const duration = action === "member_timed_out" && event.afterTimeout
    ? formatDuration(event.afterTimeout - Date.now(), resolveLanguage(config))
    : null;

  await require("../modules/logs/runtime/getLogsRuntime")
    .getLogsRuntime()
    .handleModerationEvent({
      guild,
      config,
      action,
      targetId: event.memberId,
      target: event.memberLabel,
      reason: actor.reason,
      moderator: actor.executor,
      moderatorId: actor.executorId,
      duration,
      avatarUrl: event.memberAvatarUrl,
    });
}
