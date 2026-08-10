"use strict";

async function handleTicketCreate(context, creationServiceFactory) {
  const service = creationServiceFactory(context);
  const result = await service.createTicket({
    guildId: context.guildId,
    member: context.envelope.discordMember,
    t: context.t,
  });
  await context.envelope.transport.reply({
    view: {
      title: context.t("tickets.title"),
      content: context.t(`tickets.${result.code}`, { channel: result.details.channelId ? `<#${result.details.channelId}>` : "" }),
      components: [],
    },
    ephemeral: true,
  });
  return result;
}

module.exports = { handleTicketCreate };
