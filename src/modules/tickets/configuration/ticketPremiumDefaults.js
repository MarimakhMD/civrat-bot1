"use strict";

const { TicketPremiumConfigKey: Key } = require("./ticketPremiumConstants");

// Couche Free de la résolution en couches : aucune personnalisation.
// null = « comportement Free standard » (textes i18n du panneau, nom
// ticket-<userId>, pas d'image, pas de salon transcript dédié). Les overrides
// Premium ne remplacent ces valeurs que clé par clé et seulement si
// l'entitlement TICKET_PREMIUM est actif (cf. TicketPremiumConfigResolver).
const TicketPremiumDefaults = Object.freeze({
  [Key.PANEL_TITLE]: null,
  [Key.PANEL_DESCRIPTION]: null,
  [Key.PANEL_COLOR]: null,
  [Key.PANEL_IMAGE_URL]: null,
  [Key.CREATE_BUTTON_LABEL]: null,
  [Key.NAME_FORMAT]: null,
  [Key.WELCOME_MESSAGE]: null,
  [Key.TRANSCRIPT_CHANNEL_ID]: null,
});

module.exports = { TicketPremiumDefaults };
