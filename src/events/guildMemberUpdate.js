// ═══════════════════════════════════════════════════
// EVENT: guildMemberUpdate - Roles, Nickname, Timeout
// ═══════════════════════════════════════════════════
// PHASE 1 — chaque modification réelle produit exactement un log, corrélé à la
// bonne entrée d'audit.
//
// Trois défauts corrigés :
//  • la branche rôles tournait sur CHAQUE guildMemberUpdate (pseudo, timeout,
//    boost compris), relisant l'audit et REJOUANT le dernier delta de rôles :
//    un changement de pseudo 2 s après un ajout de rôle re-journalisait cet
//    ajout ;
//  • `limit: 1` + cache 3 s faisait perdre les changements sous concurrence :
//    deux membres modifiés dans la même fenêtre → le second ne voyait que
//    l'entrée du premier, la garde de cible la rejetait, et son changement
//    n'était jamais journalisé ;
//  • le timeout acceptait N'IMPORTE QUELLE entrée `MemberUpdate` (pseudo,
//    avatar, boost) : l'auteur et la raison d'un renommage étaient attribués au
//    timeout.

const guildConfigService = require("../services/guildConfig");
const { resolveTimeoutAction, resolveRoleDeltas, AuditLogEventType } = require("../utils/auditLogActor");
const { consumeSelfAction } = require("../utils/selfActionRegistry");
const { memberDisplayLabel, roleLabel, avatarUrl, formatDuration } = require("../modules/logs/services/logLabels");

/** Délai laissé à Discord pour écrire l'entrée d'audit avant de la lire. */
const AUDIT_SETTLE_DELAY_MS = 1000;

module.exports = {
  name: "guildMemberUpdate",
  once: false,

  async execute(oldMember, newMember) {
    // Référence temporelle capturée AVANT tout `await` : elle borne l'âge des
    // entrées d'audit attribuables, malgré le délai d'attente ci-dessous.
    const occurredAt = Date.now();

    const config = await guildConfigService.getGuildConfig(newMember.guild.id);
    if (!config?.logs_enabled) return;

    const rolesChanged = roleSetChanged(oldMember, newMember);
    const nicknameChanged = oldMember.nickname !== newMember.nickname;
    const timeoutChanged = oldMember.communicationDisabledUntilTimestamp !== newMember.communicationDisabledUntilTimestamp;

    // Aucune des trois modifications → aucun log, et surtout AUCUNE lecture
    // d'Audit Log (guildMemberUpdate se déclenche aussi pour des changements
    // qui ne nous concernent pas : avatar, boost, présence…).
    if (!rolesChanged && !nicknameChanged && !timeoutChanged) return;

    if (rolesChanged) await handleRoleChanges(newMember, config, occurredAt);
    if (nicknameChanged) await handleNicknameChange(oldMember, newMember, config);
    if (timeoutChanged) await handleTimeout(oldMember, newMember, config, occurredAt);
  },
};

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

async function handleRoleChanges(newMember, config, occurredAt) {
  // Laisse Discord écrire l'entrée d'audit : le delta est lu depuis l'audit log,
  // PAS depuis la différence de caches — fragile sur membre partiel (caches
  // vides → tous les rôles apparaissent comme « ajoutés »).
  await new Promise((resolve) => setTimeout(resolve, AUDIT_SETTLE_DELAY_MS));

  // Toutes les entrées attribuables à CE membre, chacune consommée une seule
  // fois : plusieurs changements rapprochés donnent plusieurs logs distincts,
  // et un membre voisin modifié au même moment ne peut plus écraser le résultat.
  const deltas = await resolveRoleDeltas({
    guild: newMember.guild,
    type: AuditLogEventType.MEMBER_ROLE_UPDATE,
    memberId: newMember.id,
    occurredAt,
  });

  const logsRuntime = require("../modules/logs/runtime/getLogsRuntime").getLogsRuntime();

  for (const delta of deltas) {
    for (const role of delta.addedRoles) {
      if (!role || !role.id) continue;
      await logsRuntime.handleRoleEvent({
        guild: newMember.guild,
        config,
        action: "member_role_added",
        roleId: role.id,
        memberId: newMember.id,
        target: roleLabel(role),
        member: memberDisplayLabel(newMember),
        who: delta.executor,
        avatarUrl: avatarUrl(newMember),
      });
    }

    for (const role of delta.removedRoles) {
      if (!role || !role.id) continue;
      await logsRuntime.handleRoleEvent({
        guild: newMember.guild,
        config,
        action: "member_role_removed",
        roleId: role.id,
        memberId: newMember.id,
        target: roleLabel(role),
        member: memberDisplayLabel(newMember),
        who: delta.executor,
        avatarUrl: avatarUrl(newMember),
      });
    }
  }
}

async function handleNicknameChange(oldMember, newMember, config) {
  await require("../modules/logs/runtime/getLogsRuntime").getLogsRuntime().handleMemberNicknameChanged({ oldMember, newMember, config });
}

async function handleTimeout(oldMember, newMember, config, occurredAt) {
  const oldTimeout = oldMember.communicationDisabledUntilTimestamp;
  const newTimeout = newMember.communicationDisabledUntilTimestamp;

  const action = !oldTimeout && newTimeout
    ? "member_timed_out"
    : oldTimeout && !newTimeout
      ? "member_untimeout"
      : null;

  if (!action) return;

  // PHASE 1 — déduplication : un timeout appliqué par AutoMod a déjà produit
  // son log métier (`automod`, avec la règle violée). L'événement Discord qui
  // en découle n'est pas une seconde action : on ne le rejoue pas.
  if (consumeSelfAction("timeout", newMember.guild.id, newMember.id)) return;

  // Exécutant/raison résolus sur une entrée dont les `changes` portent
  // réellement `communication_disabled_until`. Sans ce filtre, une entrée de
  // pseudo / avatar / boost du même membre était attribuée au timeout.
  const actor = await resolveTimeoutAction({
    guild: newMember.guild,
    memberId: newMember.id,
    action,
    occurredAt,
  });

  // Durée : différence entre l'échéance du timeout et l'instant présent,
  // uniquement lorsque le membre vient d'être timeouté (jamais inventée).
  const duration = action === "member_timed_out" && newTimeout
    ? formatDuration(newTimeout - Date.now())
    : null;

  await require("../modules/logs/runtime/getLogsRuntime")
    .getLogsRuntime()
    .handleModerationEvent({
      guild: newMember.guild,
      config,
      action,
      targetId: newMember.id,
      target: memberDisplayLabel(newMember),
      reason: actor.reason,
      moderator: actor.executor,
      moderatorId: actor.executorId,
      duration,
      avatarUrl: avatarUrl(newMember),
    });
}
