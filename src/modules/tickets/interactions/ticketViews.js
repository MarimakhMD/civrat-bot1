"use strict";
const { TicketComponentId: Id } = require("../configuration/ticketConstants");

// Section Tickets de /settings. Phase 10.2 : ajout de l'entrée « ✨
// Personnalisation Premium ». Packing réel (DiscordResponseTransport) :
// [TOGGLE] [CATEGORY] [SUPPORT_ROLE] [PREMIUM, PREVIEW, BACK] = 4 lignes — sous
// la limite Discord de 5 lignes d'action.
function ticketView({ t, config }) {
  return {
    title: t("tickets.title"),
    content: t(config.tickets_enabled ? "tickets.enabled" : "tickets.disabled"),
    components: [
      { type: "button", customId: Id.TOGGLE, label: t(config.tickets_enabled ? "tickets.disable" : "tickets.enable"), style: config.tickets_enabled ? "success" : "secondary" },
      { type: "channel-select", customId: Id.CATEGORY, placeholder: t("tickets.category"), channelTypes: [4] },
      { type: "role-select", customId: Id.SUPPORT_ROLE, placeholder: t("tickets.supportRole") },
      { type: "button", customId: Id.PREMIUM_SECTION, label: t("tickets.premiumSection"), style: "secondary" },
      { type: "button", customId: Id.PREVIEW, label: t("tickets.preview"), style: "primary" },
      { type: "button", customId: Id.BACK, label: t("tickets.back"), style: "secondary" },
    ],
  };
}
module.exports = { ticketView };
