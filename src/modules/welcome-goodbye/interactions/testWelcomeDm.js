"use strict";
const { WelcomeGoodbyeConfigKey: Key } = require("../configuration/welcomeGoodbyeConstants");
const { normalizeWelcomeDmError } = require("../services/WelcomeDmError");
const { ValidationError } = require("../../../core/errors");
// PHASE 2 (B5) — le test DM rend les placeholders, avec la même chaîne de repli
// que la livraison (`welcome_dm_message` → `welcome_message` → défaut localisé).
// Il envoyait auparavant le texte brut, et un DM non configuré partait vide.
const { previewWelcomeDmContent } = require("../services/welcomePreview");

async function testWelcomeDm(context) {
  const config = await context.settings.get(context.guildId);
  if (!config[Key.WELCOME_DM]) throw new ValidationError({ field: "welcomeDm", reason: "welcome_dm_disabled" });
  const content = previewWelcomeDmContent({ ...context, config });
  try {
    await context.envelope.transport.sendTestWelcomeDm({ content });
  } catch (error) {
    throw normalizeWelcomeDmError(error, { guildId: context.guildId });
  }
  context.adminLogService?.record({ action: "welcome_dm_test_sent", guildId: context.guildId, actorId: context.userId });
  await context.envelope.transport.reply({ view: { content: context.t("welcomeGoodbye.testDmSent"), components: [] }, ephemeral: true });
}
module.exports = { testWelcomeDm };
