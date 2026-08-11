"use strict";
const { WelcomeGoodbyeConfigKey: Key } = require("../configuration/welcomeGoodbyeConstants");
const { welcomeView } = require("./welcomeGoodbyeViews");

// Persists the administrator template choice and re-renders the welcome sub-view.
// Allowed values are enforced by the config schema (template-1..3); an invalid
// value raises a ValidationError handled by the core error responder.
async function selectWelcomeTemplate(context) {
  const templateId = context.envelope.values?.[0];
  const config = await context.settings.update(context.guildId, { [Key.WELCOME_TEMPLATE]: templateId });
  await context.envelope.transport.update({ view: welcomeView({ t: context.t, config }) });
  return config;
}

module.exports = { selectWelcomeTemplate };
