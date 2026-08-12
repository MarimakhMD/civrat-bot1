"use strict";

const { TicketPremiumConfigKey: Key } = require("./ticketPremiumConstants");

// Schéma de validation des futures clés Premium Tickets (Phase 10.1).
// Limites alignées sur Discord et sûres quel que soit le rendu (contenu simple
// ou embed) :
//  - titre de panneau : 256 max (limite Discord des titres d'embed) ;
//  - description de panneau / message d'accueil : 2000 max (sûr en contenu
//    comme en description d'embed) ;
//  - label de bouton : 80 max (limite Discord des labels de boutons) ;
//  - couleur : hexadécimal #rrggbb (même règle que welcome-goodbye) ;
//  - image : URL https uniquement, 1024 caractères max ;
//  - format de nommage : charset [a-z0-9-_] + placeholders reconnus
//    ({number}, {username}, {userid}), 90 max, au moins un placeholder
//    d'unicité obligatoire pour éviter les collisions de salons ;
//  - salon transcript : snowflake Discord 15-22 chiffres.
// Toutes les clés sont nullable : null = reset → retour au default Free.
const TicketPremiumConfigSchema = Object.freeze({
  [Key.PANEL_TITLE]: { type: "string", maxLength: 256, nullable: true },
  [Key.PANEL_DESCRIPTION]: { type: "string", maxLength: 2000, nullable: true },
  [Key.PANEL_COLOR]: { type: "hex-color", nullable: true },
  [Key.PANEL_IMAGE_URL]: { type: "https-url", maxLength: 1024, nullable: true },
  [Key.CREATE_BUTTON_LABEL]: { type: "string", maxLength: 80, nullable: true },
  [Key.NAME_FORMAT]: { type: "ticket-name-format", maxLength: 90, nullable: true },
  [Key.WELCOME_MESSAGE]: { type: "string", maxLength: 2000, nullable: true },
  [Key.TRANSCRIPT_CHANNEL_ID]: { type: "discord-channel", nullable: true },
});

module.exports = { TicketPremiumConfigSchema };
