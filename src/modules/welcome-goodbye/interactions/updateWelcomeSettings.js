"use strict";
const { WelcomeGoodbyeConfigKey: Key } = require("../configuration/welcomeGoodbyeConstants");
const { welcomeView } = require("./welcomeGoodbyeViews");
const { welcomeUpdatedMessage } = require("./welcomeAdminMessages");
const { enforceConfigWrite } = require("../../../core/rateLimit/ActionRateLimitGuard");
// P6 §5 — garde d'écriture AVANT l'upsert ; au dépassement la réponse
// éphémère est déjà partie et la config COURANTE (non modifiée) est retournée :
// les appelants (toggles, modales) lisent les clés sans crash et sans vue
// rafraîchie — aucun écriture n'a eu lieu.
async function updateWelcomeSettings(context, updates) {
  if (!(await enforceConfigWrite(context))) return context.settings.get(context.guildId);
  const config = await context.settings.update(context.guildId, updates); const view = welcomeView({ t: context.t, config, guildId: context.guildId }); view.content = `${welcomeUpdatedMessage(context.t, config)}\n${view.content}`; await context.envelope.transport.update({ view }); return config;
}
async function toggleWelcome(context) { const config = await context.settings.get(context.guildId); return updateWelcomeSettings(context, { [Key.WELCOME_ENABLED]: !config[Key.WELCOME_ENABLED] }); }
module.exports = { updateWelcomeSettings, toggleWelcome };
