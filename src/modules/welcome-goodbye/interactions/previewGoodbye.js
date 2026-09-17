"use strict";
// PHASE 2 (B5) — l'aperçu Goodbye passe par le chemin commun avec le contexte
// RÉEL de l'administrateur. Il rendait auparavant avec `{guildId}` seul : tous
// les placeholders sortaient vides.
const { previewGoodbyePayload } = require("../services/welcomePreview");

async function previewGoodbye(context) {
  const config = await context.settings.get(context.guildId);
  const payload = await previewGoodbyePayload({ ...context, config });
  await context.envelope.transport.reply({
    view: { content: payload?.content, embed: payload?.embed, components: [] },
    ephemeral: true,
  });
}
module.exports = { previewGoodbye };
