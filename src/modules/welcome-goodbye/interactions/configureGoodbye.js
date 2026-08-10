"use strict";
const { WelcomeGoodbyeConfigKey: Key } = require("../configuration/welcomeGoodbyeConstants");
const { updateGoodbyeSettings } = require("./updateGoodbyeSettings");
async function toggleGoodbye(context) { const config=await context.settings.get(context.guildId); return updateGoodbyeSettings(context,{[Key.GOODBYE_ENABLED]:!config[Key.GOODBYE_ENABLED]}); }
async function useWelcomeChannelForGoodbye(context) { const config=await context.settings.get(context.guildId); return updateGoodbyeSettings(context,{[Key.GOODBYE_CHANNEL]:config[Key.WELCOME_CHANNEL]},"welcomeGoodbye.sameChannelApplied"); }
module.exports={toggleGoodbye,useWelcomeChannelForGoodbye};
