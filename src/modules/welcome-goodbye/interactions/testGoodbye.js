"use strict";
const { GoodbyeDeliveryError } = require("../services/GoodbyeDeliveryError");
const { WelcomeGoodbyeConfigKey: Key } = require("../configuration/welcomeGoodbyeConstants");
// PHASE 2 (B5) — le test Goodbye passe par le même service que la livraison,
// avec le contexte RÉEL de l'administrateur. Il rendait auparavant avec un
// contexte réduit à `{guildId}` : `{username}`, `{server}`, `{membercount}`
// sortaient tous vides.
const { createPreviewDeliveryService, buildPreviewContext } = require("../services/welcomePreview");

async function testGoodbye(context) {
  const config = await context.settings.get(context.guildId);
  if (!config[Key.GOODBYE_ENABLED]) throw GoodbyeDeliveryError("goodbyeDisabled", { guildId: context.guildId });
  if (!config[Key.GOODBYE_CHANNEL]) throw GoodbyeDeliveryError("goodbyeChannelMissing", { guildId: context.guildId });
  const delivery = createPreviewDeliveryService({ logService: context.deliveryLogService });
  try {
    await delivery.goodbye(buildPreviewContext({ ...context, config }), config, context.envelope.transport);
  } catch (error) {
    throw GoodbyeDeliveryError("goodbyeChannelUnavailable", { guildId: context.guildId, cause: error });
  }
  context.adminLogService?.record({ action: "goodbye_test_sent", guildId: context.guildId, actorId: context.userId });
  await context.envelope.transport.reply({ view: { content: context.t("welcomeGoodbye.testGoodbyeSent"), components: [] }, ephemeral: true });
}
module.exports = { testGoodbye };
