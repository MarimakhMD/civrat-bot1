"use strict";
const { WelcomeGoodbyeConfigKey: Key } = require("../configuration/welcomeGoodbyeConstants");
const { updateGoodbyeSettings } = require("./updateGoodbyeSettings");
async function toggleGoodbyeEmbed(context) { const config=await context.settings.get(context.guildId); return updateGoodbyeSettings(context,{[Key.GOODBYE_EMBED]:!config[Key.GOODBYE_EMBED]},!config[Key.GOODBYE_EMBED]?"welcomeGoodbye.goodbyeEmbedEnabled":"welcomeGoodbye.goodbyeEmbedDisabled"); }
async function setGoodbyeEmbedColor(context,color) { return updateGoodbyeSettings(context,{[Key.GOODBYE_COLOR]:color},"welcomeGoodbye.goodbyeEmbedColorSaved"); }
async function previewGoodbyeEmbed(context) { const config=await context.settings.get(context.guildId); await context.envelope.transport.reply({view:{content:config[Key.GOODBYE_MESSAGE],embed:{color:config[Key.GOODBYE_COLOR],description:config[Key.GOODBYE_MESSAGE]},components:[]},ephemeral:true}); }
module.exports={toggleGoodbyeEmbed,setGoodbyeEmbedColor,previewGoodbyeEmbed};
