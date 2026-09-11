"use strict";

const { memberDisplayLabel, accountCreatedAt, avatarUrl } = require("../services/logLabels");

async function handleMemberJoined({ member, config, inviteResult = null, inviterStats = null, mapper, service, delivery }) {
  if (!config.logs_enabled || member.user.bot) return null;

  const details = {
    // 👤 Membre — mention + tag (membre complet garanti à l'arrivée).
    member: memberDisplayLabel(member),
    memberId: member.id || null,
    // 📅 Compte créé
    createdAt: accountCreatedAt(member),
    // 🔗 Invitation utilisée — seulement si réellement connue.
    invite: inviteResult?.code || null,
    // 🛡️ Invité par — seulement si réellement connu.
    inviter: inviterDisplayLabel(member, inviteResult),
    // 📊 Invitations du recruteur — seulement si réellement connue.
    inviterStats: typeof inviterStats === "number" ? inviterStats : null,
    // 👥 Nombre de membres après l'arrivée.
    memberCount: typeof member.guild?.memberCount === "number" ? member.guild.memberCount : null,
    // Avatar réel du membre (thumbnail). Jamais de fallback inventé.
    avatarUrl: avatarUrl(member),
  };

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

// `findUsedInvite` renvoie l'IDENTIFIANT de l'inviteur (chaîne), pas l'objet.
// On tente de résoudre un tag depuis les caches de la guilde ; à défaut on
// conserve la mention `<@id>` (l'id est fiable). Jamais d'identité inventée.
function inviterDisplayLabel(member, inviteResult) {
  const inviterId = inviteResult && inviteResult.inviter;
  if (!inviterId) return null;
  const mention = `<@${inviterId}>`;
  const cached = resolveCachedUser(member, inviterId);
  const tag = cached && typeof cached.tag === "string" && cached.tag ? cached.tag : null;
  return tag ? `${mention} \`${tag}\`` : mention;
}

function resolveCachedUser(member, inviterId) {
  const guild = member && member.guild;
  const fromMembers = guild && guild.members && guild.members.cache && guild.members.cache.get(inviterId);
  if (fromMembers) return fromMembers.user || fromMembers;
  const fromUsers = guild && guild.client && guild.client.users && guild.client.users.cache && guild.client.users.cache.get(inviterId);
  return fromUsers || null;
}

module.exports = { handleMemberJoined };
