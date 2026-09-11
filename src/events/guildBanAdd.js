"use strict";

const { AuditLogEvent } = require("discord.js");
const { getLogsRuntime } = require("../modules/logs/runtime/getLogsRuntime");
const { userLabel } = require("../modules/logs/services/logLabels");
const { resolveAuditActor } = require("../utils/auditLogActor");

module.exports = {
  name: "guildBanAdd",
  once: false,
  async execute(ban) {
    const actor = await resolveAuditActor({ guild: ban.guild, type: AuditLogEvent.MemberBanAdd, targetId: ban.user.id });
    await getLogsRuntime().handleModerationEvent({
      guild: ban.guild,
      action: "member_banned",
      targetId: ban.user.id,
      target: userLabel(ban.user),
      reason: ban.reason || null,
      moderator: actor.executor,
      moderatorId: actor.executorId,
    });
  },
};
