// ═══════════════════════════════════════════════════
// EVENT: guildMemberUpdate - Roles, Nickname, Timeout
// ═══════════════════════════════════════════════════
// FIX: Original had 2 separate listeners. Now merged.

const { AuditLogEvent } = require("discord.js");
const guildConfigService = require("../services/guildConfig");
const { resolveAuditActor, resolveRoleDelta } = require("../utils/auditLogActor");
const { memberDisplayLabel, roleLabel, avatarUrl, formatDuration } = require("../modules/logs/services/logLabels");

module.exports = {
  name: "guildMemberUpdate",
  once: false,

  async execute(oldMember, newMember) {
    const config = await guildConfigService.getGuildConfig(newMember.guild.id);
    if (!config?.logs_enabled) return;

    await handleRoleChanges(oldMember, newMember, config);
    await handleNicknameChange(oldMember, newMember, config);
    await handleTimeout(oldMember, newMember, config);
  },
};

async function handleRoleChanges(oldMember, newMember, config) {
  // Laisse Discord écrire l'entrée d'audit (même temporisation que la
  // détection de kick) : le delta de rôles est ensuite lu depuis l'audit log,
  // PAS depuis la différence de caches — fragile sur membre partiel (caches
  // vides → tous les rôles apparaissent comme « ajoutés »).
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Delta autoritaire ($add / $remove) + exécutant, en UNE lecture d'audit.
  const delta = await resolveRoleDelta({
    guild: newMember.guild,
    type: AuditLogEvent.MemberRoleUpdate,
    memberId: newMember.id,
  });

  for (const role of delta.addedRoles) {
    if (!role || !role.id) continue;
    await require("../modules/logs/runtime/getLogsRuntime")
      .getLogsRuntime()
      .handleRoleEvent({
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
    await require("../modules/logs/runtime/getLogsRuntime")
      .getLogsRuntime()
      .handleRoleEvent({
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

async function handleNicknameChange(oldMember, newMember, config) {
  await require("../modules/logs/runtime/getLogsRuntime").getLogsRuntime().handleMemberNicknameChanged({ oldMember, newMember, config });
}

async function handleTimeout(oldMember, newMember, config) {
  const oldTimeout = oldMember.communicationDisabledUntilTimestamp;
  const newTimeout = newMember.communicationDisabledUntilTimestamp;

  if (oldTimeout === newTimeout) return;

  const action = !oldTimeout && newTimeout
    ? "member_timed_out"
    : oldTimeout && !newTimeout
      ? "member_untimeout"
      : null;

  if (!action) return;

  // P1b — exécutant/raison résolus via Audit Log, cible = le membre.
  const actor = await resolveAuditActor({
    guild: newMember.guild,
    type: AuditLogEvent.MemberUpdate,
    targetId: newMember.id,
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
