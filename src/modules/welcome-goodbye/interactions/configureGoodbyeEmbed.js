"use strict";
const { WelcomeGoodbyeConfigKey: Key } = require("../configuration/welcomeGoodbyeConstants");
const { updateGoodbyeSettings } = require("./updateGoodbyeSettings");
// PHASE 2 (B5) — idem côté Goodbye : texte rendu par le chemin commun.
const { previewGoodbyeEmbedPayload } = require("../services/welcomePreview");

async function toggleGoodbyeEmbed(context) { const config=await context.settings.get(context.guildId); return updateGoodbyeSettings(context,{[Key.GOODBYE_EMBED]:!config[Key.GOODBYE_EMBED]},!config[Key.GOODBYE_EMBED]?"welcomeGoodbye.goodbyeEmbedEnabled":"welcomeGoodbye.goodbyeEmbedDisabled"); }
async function setGoodbyeEmbedColor(context,color) { return updateGoodbyeSettings(context,{[Key.GOODBYE_COLOR]:color},"welcomeGoodbye.goodbyeEmbedColorSaved"); }
async function previewGoodbyeEmbed(context) {
  const config = await context.settings.get(context.guildId);
  const payload = previewGoodbyeEmbedPayload({ ...context, config });
  await context.envelope.transport.reply({ view: { content: payload.content, embed: payload.embed, components: [] }, ephemeral: true });
}
module.exports = { toggleGoodbyeEmbed, setGoodbyeEmbedColor, previewGoodbyeEmbed };
