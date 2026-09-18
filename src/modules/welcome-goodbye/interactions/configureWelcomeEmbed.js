"use strict";
const { WelcomeGoodbyeConfigKey: Key } = require("../configuration/welcomeGoodbyeConstants");
const { updateWelcomeSettings } = require("./updateWelcomeSettings");
// PHASE 2 (B5) — l'aperçu embed envoie le texte RENDU par le chemin commun.
// Il affichait auparavant `welcome_message` brut (`{mention}` littéral).
const { previewWelcomeEmbedPayload } = require("../services/welcomePreview");

async function toggleWelcomeEmbed(context) { const config = await context.settings.get(context.guildId); return updateWelcomeSettings(context,{[Key.WELCOME_EMBED]:!config[Key.WELCOME_EMBED]}); }
async function setWelcomeEmbedColor(context,color) { return updateWelcomeSettings(context,{[Key.WELCOME_COLOR]:color}); }
async function previewWelcomeEmbed(context) {
  const config = await context.settings.get(context.guildId);
  const payload = previewWelcomeEmbedPayload({ ...context, config });
  await context.envelope.transport.reply({ view: { content: payload.content, embed: payload.embed, components: [] }, ephemeral: true });
}
module.exports = { toggleWelcomeEmbed, setWelcomeEmbedColor, previewWelcomeEmbed };
