"use strict";

const { WelcomeTemplateRenderer, defaultPlaceholderProviders } = require("./WelcomeTemplateRenderer");

/**
 * PHASE 2 (B5) — UN SEUL CHEMIN DE RENDU pour l'aperçu, le test et la livraison.
 *
 * Avant cette correction, quatre boutons envoyaient le texte BRUT (sans rendu
 * des placeholders) et deux autres rendaient avec un contexte réduit à
 * `{guildId}`, donc avec tous les placeholders vides. L'administrateur validait
 * un aperçu qui ne correspondait à rien de ce qui serait réellement envoyé.
 *
 * Ces deux fonctions sont désormais la seule façon de produire un payload
 * Welcome/Goodbye : `WelcomeDeliveryService` (livraison) et les interactions
 * (aperçu, test) appellent exactement les mêmes, avec le même contexte de
 * membre. Un aperçu ne peut plus diverger de la livraison.
 */

/** Renderer Free standard du module (mêmes providers partout). */
function createWelcomeRenderer() {
  return new WelcomeTemplateRenderer({ providers: defaultPlaceholderProviders() });
}

/**
 * Construit le payload remis au transport.
 *
 * Contrat inchangé : quand l'embed est activé, le texte rendu est porté par la
 * description de l'embed.
 */
function buildDeliveryPayload({ content, embedEnabled, color }) {
  return {
    content,
    embed: embedEnabled ? { color, description: content } : null,
  };
}

/** Rend le message puis construit le payload, en une seule étape. */
function renderDeliveryPayload({ renderer, message, context, embedEnabled, color }) {
  const active = renderer || createWelcomeRenderer();
  const content = active.render(message, context);
  return buildDeliveryPayload({ content, embedEnabled, color });
}

module.exports = { createWelcomeRenderer, buildDeliveryPayload, renderDeliveryPayload };
