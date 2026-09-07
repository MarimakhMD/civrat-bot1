"use strict";
const { TicketComponentId: Id } = require("../configuration/ticketConstants");

// Section Tickets de /settings. Phase 10.2 : entrée « ✨ Personnalisation
// Premium ». P13 (B3) : sélecteur du salon de logs/transcripts Free.
// M8 (D-A) : l'entrée « Aperçu » est remplacée par l'entrée « Panels » — la vue
// occupe déjà les 5 lignes d'action autorisées par Discord, il fallait donc
// libérer une place plutôt qu'en ajouter une. La route previewTickets reste
// enregistrée (aucune suppression sans autorisation) mais n'est plus atteignable
// depuis cette vue.
// Packing réel (DiscordResponseTransport) : [TOGGLE] [CATEGORY] [SUPPORT_ROLE]
// [LOG_CHANNEL] [PREMIUM, PANELS, BACK] = 5 lignes — exactement la limite
// Discord de 5 lignes d'action.
function ticketView({ t, config }) {
  return {
    title: t("tickets.title"),
    content: t(config.tickets_enabled ? "tickets.enabled" : "tickets.disabled"),
    components: [
      { type: "button", customId: Id.TOGGLE, label: t(config.tickets_enabled ? "tickets.disable" : "tickets.enable"), style: config.tickets_enabled ? "success" : "secondary" },
      { type: "channel-select", customId: Id.CATEGORY, placeholder: t("tickets.category"), channelTypes: [4] },
      { type: "role-select", customId: Id.SUPPORT_ROLE, placeholder: t("tickets.supportRole") },
      { type: "channel-select", customId: Id.LOG_CHANNEL, placeholder: t("tickets.logChannel"), channelTypes: [0] },
      { type: "button", customId: Id.PREMIUM_SECTION, label: t("tickets.premiumSection"), style: "secondary" },
      { type: "button", customId: Id.PANELS_SECTION, label: t("tickets.panelsSection"), style: "primary" },
      { type: "button", customId: Id.BACK, label: t("tickets.back"), style: "secondary" },
    ],
  };
}
module.exports = { ticketView };
