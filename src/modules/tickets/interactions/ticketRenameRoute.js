"use strict";

const { TicketComponentId: Id } = require("../configuration/ticketConstants");

async function openTicketRename(context) {
  return context.envelope.transport.showModal({
    customId: Id.RENAME_SUBMIT,
    title: context.t("tickets.renameModalTitle"),
    fields: [{ id: "ticket_name", label: context.t("tickets.renameField"), required: true }],
  });
}

async function handleTicketRename(context, creationServiceFactory) {
  const service = creationServiceFactory(context);
  const result = await service.renameTicket({
    guildId: context.guildId,
    channelId: context.envelope.discordChannel?.id || null,
    member: context.envelope.discordMember,
    name: context.envelope.modalValues?.ticket_name || null,
  });
  await context.envelope.transport.reply({
    view: { title: context.t("tickets.title"), content: context.t(`tickets.${result.code}`), components: [] },
    ephemeral: true,
  });
  return result;
}

module.exports = { openTicketRename, handleTicketRename };
