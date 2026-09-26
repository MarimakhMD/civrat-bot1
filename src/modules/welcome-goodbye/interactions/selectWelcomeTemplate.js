"use strict";
const { WelcomeGoodbyeConfigKey: Key, CIVRAT_GUILD_ID, CIVRAT_TEMPLATE_ID } = require("../configuration/welcomeGoodbyeConstants");
const { welcomeView } = require("./welcomeGoodbyeViews");
const { ValidationError } = require("../../../core/errors");

// Persists the administrator template choice and re-renders the welcome sub-view.
// Allowed values are enforced by the config schema (template-1..3 + civrat); an
// invalid value raises a ValidationError handled by the core error responder.
async function selectWelcomeTemplate(context) {
  const templateId = context.envelope.values?.[0];
  // Template officiel CIVRAT : réservé au guildId exact. Un autre serveur ne
  // peut pas le sélectionner, même en forçant la valeur du menu.
  if (templateId === CIVRAT_TEMPLATE_ID && String(context.guildId) !== CIVRAT_GUILD_ID) {
    throw new ValidationError({ field: Key.WELCOME_TEMPLATE, reason: "invalid_value" });
  }
  const config = await context.settings.update(context.guildId, { [Key.WELCOME_TEMPLATE]: templateId });
  await context.envelope.transport.update({ view: welcomeView({ t: context.t, config, guildId: context.guildId }) });
  return config;
}

module.exports = { selectWelcomeTemplate };
