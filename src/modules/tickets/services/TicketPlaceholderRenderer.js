"use strict";

// Placeholders du contenu personnalisable des tickets (Phase 10.3).
// Convention alignée sur welcome-goodbye (WelcomeTemplateRenderer) : mêmes
// noms de placeholders, tokens inconnus conservés tels quels, données
// manquantes remplacées par une chaîne vide. {supportrole} est spécifique aux
// tickets (mention du rôle support configuré).
class TicketPlaceholderRenderer {
  render(template, context = {}) {
    const values = ticketPlaceholderValues(context);
    return String(template || "").replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (token, name) => (
      Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : token
    ));
  }
}

function ticketPlaceholderValues({ member = null, supportRole = null } = {}) {
  const memberId = member?.id || "";
  return {
    user: memberId ? `<@${memberId}>` : "",
    mention: memberId ? `<@${memberId}>` : "",
    username: member?.user?.username || "",
    displayname: member?.displayName || "",
    userid: memberId,
    server: member?.guild?.name || "",
    supportrole: supportRole?.id ? `<@&${supportRole.id}>` : "",
  };
}

module.exports = { TicketPlaceholderRenderer, ticketPlaceholderValues };
