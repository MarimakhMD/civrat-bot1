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
      // P15 — convergence : l'accueil expose les 5 actions du cycle de vie
      // (fermer, claim, renommer, ajouter, retirer), branchées sur les routes
      // modulaires civrat:v1:tickets:* — exactement la capacité d'une
      // ActionRow Discord (5 boutons).
      components: [
        { type: "button", customId: Id.CLOSE, label: t("tickets.close"), style: "danger" },
        { type: "button", customId: Id.CLAIM, label: t("tickets.claim"), style: "secondary" },
        { type: "button", customId: Id.RENAME, label: t("tickets.rename"), style: "secondary" },
        { type: "button", customId: Id.ADD_MEMBER, label: t("tickets.addMember"), style: "secondary" },
        { type: "button", customId: Id.REMOVE_MEMBER, label: t("tickets.removeMember"), style: "secondary" },
      ],
    };
  }
}

module.exports = { TicketWelcomeService };
