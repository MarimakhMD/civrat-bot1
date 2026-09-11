"use strict";

const { memberLabel } = require("../services/logLabels");

async function handleMemberLeft({ member, config, mapper, service, delivery }) {
  if (!config.logs_enabled) return null;
  // Un membre parti hors cache arrive en « partiel » (Partials.GuildMember) :
  // `member.user` vaut alors null. On logue quand même, avec l'id toujours
  // disponible. Pas de champ `who` : un départ volontaire n'a pas d'acteur
  // (un kick est traité par le log de modération séparé).
  if (member.user?.bot) return null;
  const entry = mapper.map({
    guildId: member.guild.id,
    channelKey: "log_member_leave_channel_id",
    category: "members",
    action: "member_left",
    title: "logs.memberLeft",
    details: {
      target: memberLabel(member),
      memberId: member.id || null,
    },
  });
  return delivery.deliver({ ...entry, channelId: service.resolveDestination(entry, config) });
}

module.exports = { handleMemberLeft };
