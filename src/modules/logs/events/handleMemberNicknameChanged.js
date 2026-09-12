"use strict";

const { memberDisplayLabel, avatarUrl } = require("../services/logLabels");

async function handleMemberNicknameChanged({ oldMember, newMember, config, mapper, service, delivery }) {
  if (!config.logs_enabled || oldMember.nickname === newMember.nickname) return null;
  const entry = mapper.map({
    guildId: newMember.guild.id,
    channelKey: "log_member_join_channel_id",
    category: "members",
    action: "member_nickname_changed",
    title: "logs.memberNicknameChanged",
    // Pas de `who` : un membre peut modifier son propre pseudo, l'auteur n'est
    // donc pas attribuable de façon fiable sans Audit Log (non effectué ici).
    details: {
      member: memberDisplayLabel(newMember),
      before: oldMember.nickname || null,
      after: newMember.nickname || null,
      memberId: newMember.id || null,
      avatarUrl: avatarUrl(newMember),
    },
  });
  return delivery.deliver({ ...entry, channelId: service.resolveDestination(entry, config) });
}

module.exports = { handleMemberNicknameChanged };
