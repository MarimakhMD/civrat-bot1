"use strict";

const { TicketComponentId: Id } = require("../configuration/ticketConstants");
const { TicketPlaceholderRenderer } = require("./TicketPlaceholderRenderer");

class TicketWelcomeService {
  constructor({ placeholderRenderer = null } = {}) {
    this.placeholderRenderer = placeholderRenderer || new TicketPlaceholderRenderer();
  }

  build({ t, member, supportRole, welcomeMessage = null }) {
    // Phase 10.3 : welcomeMessage n'existe que si le resolver a autorisé
    // Premium (entitlement TICKET_PREMIUM actif + valeur valide). null =
    // description i18n Free historique, strictement inchangée.
    const description = welcomeMessage
      ? this.placeholderRenderer.render(welcomeMessage, { member, supportRole })
      : t("tickets.welcomeDescription");
    return {
      title: t("tickets.welcomeTitle"),
      description,
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
