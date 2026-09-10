"use strict";

async function handleMemberLeft({ member, config, mapper, service, delivery }) {
  if (!config.logs_enabled) return null;
  // Un membre parti hors cache arrive en « partiel » (Partials.GuildMember) :
  // `member.user` vaut alors null. On ne peut donc pas déterminer s'il s'agit
  // d'un bot — on logue quand même, avec l'id toujours disponible.
  if (member.user?.bot) return null;
  const entry = mapper.map({
    guildId: member.guild.id,
    channelKey: "log_member_leave_channel_id",
    category: "members",
    action: "member_left",
    title: "logs.memberLeft",
    details: { memberId: member.id },
  });
  return delivery.deliver({ ...entry, channelId: service.resolveDestination(entry, config) });
}

module.exports = { handleMemberLeft };
