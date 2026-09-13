const guildConfigService = require("../services/guildConfig");
const inviteService = require("../services/inviteService");
const { getLogsRuntime } = require("../modules/logs/runtime/getLogsRuntime");
const { userLabel, channelLabel } = require("../modules/logs/services/logLabels");

module.exports = {
  name: "inviteCreate",
  once: false,
  async execute(invite) {
    const invites = await invite.guild.invites.fetch().catch(() => null);
    if (invites) inviteService.cacheGuildInvites(invite.guild.id, invites);
    const config = await guildConfigService.getGuildConfig(invite.guild.id);
    // P1a — l'inviteur, le salon, l'expiration et les usages sont directement
    // disponibles dans l'événement : aucun appel Audit Log n'est nécessaire.
    await getLogsRuntime().handleInviteEvent({
      guild: invite.guild,
      config,
      action: "invite_created",
      inviteCode: invite.code,
      inviter: userLabel(invite.inviter),
      channel: channelLabel(invite.channel),
      expiresAt: invite.expiresAt ? new Date(invite.expiresAt).toISOString() : null,
      uses: invite.uses ?? null,
      maxUses: invite.maxUses ?? null,
    });
  },
};
