"use strict";

// Clés de configuration réservées à la personnalisation Premium des tickets
// (Phase 10.1 — fondations). Ces clés sont stockées dans guild_configs mais ne
// sont JAMAIS consommées par le parcours Free : seul TicketPremiumConfigResolver
// les expose, et uniquement quand l'entitlement TICKET_PREMIUM est actif.
const TicketPremiumConfigKey = Object.freeze({
  PANEL_TITLE: "ticket_panel_title",
  PANEL_DESCRIPTION: "ticket_panel_description",
  PANEL_COLOR: "ticket_panel_color",
  PANEL_IMAGE_URL: "ticket_panel_image_url",
  CREATE_BUTTON_LABEL: "ticket_create_button_label",
  NAME_FORMAT: "ticket_name_format",
  WELCOME_MESSAGE: "ticket_welcome_message",
  TRANSCRIPT_CHANNEL_ID: "ticket_transcript_channel_id",
});

module.exports = { TicketPremiumConfigKey };
