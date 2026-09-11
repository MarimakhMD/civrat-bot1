"use strict";

const { userLabel, memberLabel } = require("../services/logLabels");

async function handleMemberJoined({ member, config, inviteResult = null, mapper, service, delivery }) {
  if (!config.logs_enabled || member.user.bot) return null;

  const inviterLabel = resolveInviterLabel(member, inviteResult);
  const details = {
    target: memberLabel(member),
    invite: inviteResult?.code || null,
    joinedAt: member.joinedAt ? new Date(member.joinedAt).toISOString() : null,
    memberId: member.id || null,
  };
  // `who` = inviteur, seulement si une attribution fiable existe ; sinon le
  // champ est omis (pas d'identité inventée).
  if (inviterLabel) details.who = inviterLabel;

  const entry = mapper.map({
    guildId: member.guild.id,
    channelKey: "log_member_join_channel_id",
    category: "members",
    action: "member_joined",
    title: "logs.memberJoined",
    details,
  });
  return delivery.deliver({ ...entry, channelId: service.resolveDestination(entry, config) });
}

// `findUsedInvite` renvoie l'identifiant de l'inviteur (chaîne), pas l'objet.
// On tente de résoudre un tag depuis les caches de la guilde, à défaut on
// conserve l'identifiant brut. Jamais d'identité inventée.
function resolveInviterLabel(member, inviteResult) {
  const inviterId = inviteResult && inviteResult.inviter;
  if (!inviterId) return null;
  const guild = member && member.guild;
  const cached = (guild && guild.members && guild.members.cache && guild.members.cache.get(inviterId))
    || (guild && guild.client && guild.client.users && guild.client.users.cache && guild.client.users.cache.get(inviterId));
  return userLabel(cached) || String(inviterId);
}

module.exports = { handleMemberJoined };
