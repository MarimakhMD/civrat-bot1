"use strict";

const { TicketComponentId: Id } = require("../configuration/ticketConstants");

class TicketWelcomeService {
  build({ t, member, supportRole }) {
    return {
      title: t("tickets.welcomeTitle"),
      description: t("tickets.welcomeDescription"),
      fields: [
        { name: t("tickets.welcomeCreator"), value: `<@${member.id}>`, inline: true },
        { name: t("tickets.welcomeSupportRole"), value: `<@&${supportRole.id}>`, inline: true },
      ],
      components: [
        { type: "button", customId: Id.CLOSE, label: t("tickets.close"), style: "danger" },
        { type: "button", customId: Id.CLAIM, label: t("tickets.claim"), style: "secondary" },
      ],
    };
  }
}

module.exports = { TicketWelcomeService };
