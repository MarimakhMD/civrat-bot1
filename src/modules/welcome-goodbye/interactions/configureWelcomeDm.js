"use strict";
const { WelcomeGoodbyeConfigKey: Key } = require("../configuration/welcomeGoodbyeConstants");
const { updateWelcomeSettings } = require("./updateWelcomeSettings");
async function toggleWelcomeDm(context) { const config=await context.settings.get(context.guildId); return updateWelcomeSettings(context,{[Key.WELCOME_DM]:!config[Key.WELCOME_DM]}); }
module.exports={toggleWelcomeDm};
