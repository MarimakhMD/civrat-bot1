"use strict";

// Phase 1 (C15) : garde alignée sur celle du tracking des invitations
// (src/events/guildMemberAdd.js — `config.invitations_enabled !== false`).
//
// L'ancienne garde `!config.invitations_enabled` était une vérité STRICTE :
// sur une guilde n'ayant jamais ouvert /settings, la clé vaut `undefined`,
// donc le tracking s'exécutait (défaut « activé ») pendant que le log
// d'invitation était silencieusement jeté. Les deux chemins partagent
// désormais la même sémantique : défaut activé, opt-out explicite uniquement.
async function handleInviteEvent({ guild, config, action, inviteCode, mapper, service, delivery }) {
  if (!config.logs_enabled || config.invitations_enabled === false) return null;
  const entry = mapper.map({
    guildId: guild.id,
    channelKey: "invitations_log_channel_id",
    category: "invitations",
    action,
    title: `logs.${action}`,
    details: { inviteCode },
  });
  return delivery.deliver({ ...entry, channelId: service.resolveDestination(entry, config) });
}

module.exports = { handleInviteEvent };
