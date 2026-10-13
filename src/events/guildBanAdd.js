"use strict";

const { AuditLogEvent } = require("discord.js");
const { getLogsRuntime } = require("../modules/logs/runtime/getLogsRuntime");
const guildConfigService = require("../services/guildConfig");
const { memberDisplayLabel, avatarUrl } = require("../modules/logs/services/logLabels");
const { resolveAuditActor } = require("../utils/auditLogActor");

module.exports = {
  name: "guildBanAdd",
  once: false,
  async execute(ban) {
    // PHASE 1 — la config est lue AVANT l'Audit Log : si les logs sont coupés,
    // aucune requête API n'est émise pour un log qui sera jeté.
    const config = await guildConfigService.getGuildConfig(ban.guild.id);
    if (!config?.logs_enabled) return;

    const actor = await resolveAuditActor({ guild: ban.guild, type: AuditLogEvent.MemberBanAdd, targetId: ban.user.id });

    await getLogsRuntime().handleModerationEvent({
      guild: ban.guild,
      config,
      action: "member_banned",
      targetId: ban.user.id,
      target: memberDisplayLabel(ban.user),
      // `GuildBan.reason` n'est renseigné que si le ban a été récupéré avec sa
      // raison ; l'entrée d'audit est la source la plus fiable. On ne mélange
      // jamais les deux : la première valeur réellement disponible gagne.
      reason: ban.reason || actor.reason,
      moderator: actor.executor,
      moderatorId: actor.executorId,
      avatarUrl: avatarUrl(ban.user),
    });
  },
};
