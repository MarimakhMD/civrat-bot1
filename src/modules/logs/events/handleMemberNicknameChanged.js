"use strict";

const { memberDisplayLabel, avatarUrl } = require("../services/logLabels");
const { localizeTitle } = require("../services/logTitles");
const { resolveLanguage } = require("../services/logLanguage");

async function handleMemberNicknameChanged({ oldMember, newMember, config, mapper, service, delivery }) {
  if (!config.logs_enabled || oldMember.nickname === newMember.nickname) return null;
  const entry = mapper.map({
    guildId: newMember.guild.id,
    channelKey: "log_moderation_channel_id",
    // PHASE 1 — routage cohérent : ce log part dans le salon « modération »,
    // sa catégorie déclarée doit donc être la même (la catégorie sert au
    // diagnostic de livraison ; une divergence masquait la destination réelle).
    category: "moderation",
    language: resolveLanguage(config),
    action: "member_nickname_changed",
    title: localizeTitle(config, "logs.memberNicknameChanged"),
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
