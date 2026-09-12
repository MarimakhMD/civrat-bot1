"use strict";

const { memberDisplayLabel, accountCreatedAt, avatarUrl, inviterDisplayLabel } = require("../services/logLabels");

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
    inviter: inviterDisplayLabel(member, inviteResult?.inviter),
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

module.exports = { handleMemberJoined };
