"use strict";

const { memberDisplayLabel, accountCreatedAt, avatarUrl } = require("../services/logLabels");
const { localizeTitle } = require("../services/logTitles");
const { resolveLanguage } = require("../services/logLanguage");

async function handleMemberLeft({ member, config, mapper, service, delivery }) {
  if (!config.logs_enabled) return null;
  // Un membre parti hors cache arrive en « partiel » (Partials.GuildMember) :
  // `member.user` vaut alors null. On logue quand même avec les informations
  // réellement disponibles : mention `<@id>` + id, mais pas de tag, pas de date
  // de création, pas d'avatar (jamais inventés).
  if (member.user?.bot) return null;

  const details = {
    member: memberDisplayLabel(member),
    memberId: member.id || null,
    createdAt: accountCreatedAt(member),
    memberCount: typeof member.guild?.memberCount === "number" ? member.guild.memberCount : null,
    avatarUrl: avatarUrl(member),
  };

  const entry = mapper.map({
    guildId: member.guild.id,
    channelKey: "log_member_leave_channel_id",
    // PHASE 1 — catégorie alignée sur la clé de salon. Elle valait « members »,
    // donc un échec de livraison de ce log orientait l'administrateur vers le
    // réglage du salon d'ARRIVÉE au lieu de celui des départs.
    category: "members_leave",
    language: resolveLanguage(config),
    action: "member_left",
    title: localizeTitle(config, "logs.memberLeft"),
    details,
  });
  return delivery.deliver({ ...entry, channelId: service.resolveDestination(entry, config) });
}

module.exports = { handleMemberLeft };
