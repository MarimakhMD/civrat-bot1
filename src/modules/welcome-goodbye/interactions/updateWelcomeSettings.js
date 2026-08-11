"use strict";
const { WelcomeGoodbyeConfigKey: Key } = require("../configuration/welcomeGoodbyeConstants");
const { welcomeView } = require("./welcomeGoodbyeViews");
const { welcomeUpdatedMessage } = require("./welcomeAdminMessages");
async function updateWelcomeSettings(context, updates) { const config = await context.settings.update(context.guildId, updates); const view = welcomeView({ t: context.t, config }); view.content = `${welcomeUpdatedMessage(context.t, config)}\n${view.content}`; await context.envelope.transport.update({ view }); return config; }
async function toggleWelcome(context) { const config = await context.settings.get(context.guildId); return updateWelcomeSettings(context, { [Key.WELCOME_ENABLED]: !config[Key.WELCOME_ENABLED] }); }
module.exports = { updateWelcomeSettings, toggleWelcome };
