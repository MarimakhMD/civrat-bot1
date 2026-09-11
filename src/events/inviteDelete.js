const { AuditLogEvent } = require("discord.js");
const guildConfigService = require("../services/guildConfig");
const inviteService = require("../services/inviteService");
const { getLogsRuntime } = require("../modules/logs/runtime/getLogsRuntime");
const { resolveAuditActor } = require("../utils/auditLogActor");

module.exports = {
  name: "inviteDelete",
  once: false,
  async execute(invite) {
    const invites = await invite.guild.invites.fetch().catch(() => null);
    if (invites) inviteService.cacheGuildInvites(invite.guild.id, invites);
    const config = await guildConfigService.getGuildConfig(invite.guild.id);
    // P1b — l'inviteur n'est pas présent dans l'événement inviteDelete :
    // résolution Audit Log avec correspondance stricte sur le code.
    const actor = await resolveAuditActor({ guild: invite.guild, type: AuditLogEvent.InviteDelete, targetCode: invite.code });
    await getLogsRuntime().handleInviteEvent({
      guild: invite.guild,
      config,
      action: "invite_deleted",
      inviteCode: invite.code,
      inviter: actor.executor,
    });
  },
};
