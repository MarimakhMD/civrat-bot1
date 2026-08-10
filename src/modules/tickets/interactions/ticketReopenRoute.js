"use strict";

async function handleTicketReopen(context, creationServiceFactory) {
  const service = creationServiceFactory(context);
  const result = await service.reopenTicket({
    guildId: context.guildId,
    channelId: context.envelope.discordChannel?.id || null,
    member: context.envelope.discordMember,
  });
  await context.envelope.transport.reply({
    view: { title: context.t("tickets.title"), content: context.t(`tickets.${result.code}`), components: [] },
    ephemeral: true,
  });
  return result;
}

module.exports = { handleTicketReopen };
