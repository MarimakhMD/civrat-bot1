"use strict";

const { AuditLogEvent } = require("discord.js");
const { getLogsRuntime } = require("../modules/logs/runtime/getLogsRuntime");
const guildConfigService = require("../services/guildConfig");
const { memberDisplayLabel, avatarUrl } = require("../modules/logs/services/logLabels");
const { resolveAuditActor } = require("../utils/auditLogActor");

module.exports = {
  name: "guildBanRemove",
  once: false,
  async execute(ban) {
    // PHASE 1 — la config est lue AVANT l'Audit Log.
    const config = await guildConfigService.getGuildConfig(ban.guild.id);
    if (!config?.logs_enabled) return;

    const actor = await resolveAuditActor({ guild: ban.guild, type: AuditLogEvent.MemberBanRemove, targetId: ban.user.id });

    await getLogsRuntime().handleModerationEvent({
      guild: ban.guild,
      config,
      action: "member_unbanned",
      targetId: ban.user.id,
      target: memberDisplayLabel(ban.user),
      moderator: actor.executor,
      moderatorId: actor.executorId,
      avatarUrl: avatarUrl(ban.user),
    });
  },
};
