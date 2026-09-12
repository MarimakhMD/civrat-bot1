// ═══════════════════════════════════════════════════
// EVENT: guildMemberUpdate - Roles, Nickname, Timeout
// ═══════════════════════════════════════════════════
// FIX: Original had 2 separate listeners. Now merged.

const { AuditLogEvent } = require("discord.js");
const guildConfigService = require("../services/guildConfig");
const { resolveAuditActor } = require("../utils/auditLogActor");
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
  // P1b — un seul audit log pour le lot (cible = le membre), puis réutilisé.
  const actor = await resolveAuditActor({
    guild: newMember.guild,
    type: AuditLogEvent.MemberRoleUpdate,
    targetId: newMember.id,
  });

  const addedRoles = newMember.roles.cache.filter((role) => !oldMember.roles.cache.has(role.id));
  for (const role of addedRoles.values()) {
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
        who: actor.executor,
        avatarUrl: avatarUrl(newMember),
      });
  }

  const removedRoles = oldMember.roles.cache.filter((role) => !newMember.roles.cache.has(role.id));
  for (const role of removedRoles.values()) {
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
        who: actor.executor,
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
