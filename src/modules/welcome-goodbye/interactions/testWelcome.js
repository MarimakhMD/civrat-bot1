"use strict";
const { WelcomeGoodbyeConfigKey: Key } = require("../configuration/welcomeGoodbyeConstants");
const { ValidationError } = require("../../../core/errors");
// PHASE 2 (B5) — le test en salon envoie le payload RENDU par le même chemin que
// la livraison. Auparavant il envoyait `welcome_message` brut : l'administrateur
// voyait `{mention}` littéral alors que le vrai Welcome était résolu.
const { previewWelcomePayload } = require("../services/welcomePreview");

async function testWelcome(context) {
  const config = await context.settings.get(context.guildId);
  if (!config[Key.WELCOME_ENABLED] || !config[Key.WELCOME_CHANNEL]) {
    throw new ValidationError({ field: "welcome", reason: "welcome_requires_enabled_channel" });
  }
  const payload = await previewWelcomePayload({ ...context, config });
  await context.envelope.transport.sendTestWelcome({
    channelId: config[Key.WELCOME_CHANNEL],
    content: payload ? payload.content : "",
    embed: payload ? payload.embed : null,
  });
  context.adminLogService?.record({ action: "welcome_test_sent", guildId: context.guildId, actorId: context.userId });
  await context.envelope.transport.reply({
    view: { content: context.t("welcomeGoodbye.testWelcomeSent"), components: [] },
    ephemeral: true,
  });
}
module.exports = { testWelcome };
