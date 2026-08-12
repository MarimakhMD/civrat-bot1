"use strict";

async function handleTicketReopen(context, creationServiceFactory) {
  const service = creationServiceFactory(context);
  // P15 : t est transmis pour la notice post-réouverture (best-effort).
  const result = await service.reopenTicket({
    guildId: context.guildId,
    channelId: context.envelope.discordChannel?.id || null,
    member: context.envelope.discordMember,
    t: context.t,
  });
  await context.envelope.transport.reply({
    view: { title: context.t("tickets.title"), content: context.t(`tickets.${result.code}`), components: [] },
    ephemeral: true,
  });
  return result;
}

module.exports = { handleTicketReopen };
