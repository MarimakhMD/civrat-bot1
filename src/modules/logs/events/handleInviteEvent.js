"use strict";

async function handleInviteEvent({
  guild,
  config,
  action,
  inviteCode,
  inviter = undefined,
  channel = null,
  expiresAt = null,
  uses = null,
  maxUses = null,
  member = null,
  avatarUrl = null,
  mapper,
  service,
  delivery,
}) {
  if (!config.logs_enabled || config.invitations_enabled === false) return null;

  const details = {
    invite: inviteCode || null,
  };
  if (member) details.member = member;
  if (avatarUrl) details.avatarUrl = avatarUrl;
  if (channel) details.channel = channel;
  if (expiresAt) details.expiresAt = expiresAt;
  if (uses !== null && uses !== undefined) details.uses = uses;
  if (maxUses !== null && maxUses !== undefined) details.maxUses = maxUses;
  // `who` = créateur de l'invitation. Absent (invites d'application/vanity) →
  // « inconnu » ; jamais d'identité inventée.
  if (inviter !== undefined) details.who = inviter;

  const entry = mapper.map({
    guildId: guild.id,
    channelKey: "invitations_log_channel_id",
    category: "invitations",
    action,
    title: `logs.${action}`,
    details,
  });
  return delivery.deliver({ ...entry, channelId: service.resolveDestination(entry, config) });
}

module.exports = { handleInviteEvent };
