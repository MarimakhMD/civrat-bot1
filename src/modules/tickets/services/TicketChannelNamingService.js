"use strict";

const { TicketPlaceholderRenderer } = require("./TicketPlaceholderRenderer");
const { isValidTicketNameFormat } = require("../configuration/ticketPremiumValidation");

// Nommage des salons Ticket (Phase 10.4, Premium). Rendu pur et défensif :
//  - format revalidé ici (défense en profondeur : une valeur invalide stockée
//    hors chemin validé ne produit jamais de nom) ;
//  - placeholders résolus ({number} paddé 3, {username}, {userid}) ; un format
//    contenant {number} sans compteur fourni ne rend rien (unicité) ;
//  - sanitisation Discord : lowercase, caractères hors [a-z0-9-_] remplacés
//    par « - », tirets multiples fusionnés, tirets de bord supprimés ;
//  - tronqué à 100 caractères (limite Discord des noms de salons) ;
//  - résultat vide/invalide => null => l'appelant retombe sur le nom Free.
class TicketChannelNamingService {
  constructor({ placeholderRenderer = null } = {}) {
    this.placeholderRenderer = placeholderRenderer || new TicketPlaceholderRenderer();
  }

  build({ format, member = null, supportRole = null, number = null }) {
    if (typeof format !== "string" || !isValidTicketNameFormat(format)) return null;
    if (format.includes("{number}") && (number === null || number === undefined)) return null;
    const rendered = this.placeholderRenderer.render(format, { member, supportRole, number });
    const name = rendered
      .toLowerCase()
      .replace(/[^a-z0-9\-_]+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 100);
    return /^[a-z0-9][a-z0-9-_]*$/.test(name) ? name : null;
  }
}

module.exports = { TicketChannelNamingService };
