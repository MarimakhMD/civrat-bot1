"use strict";
const { WelcomeGoodbyeConfigKey: Key } = require("../configuration/welcomeGoodbyeConstants");
const { updateWelcomeSettings } = require("./updateWelcomeSettings");
async function toggleWelcomeEmbed(context) { const config=await context.settings.get(context.guildId); return updateWelcomeSettings(context,{[Key.WELCOME_EMBED]:!config[Key.WELCOME_EMBED]}); }
async function setWelcomeEmbedColor(context,color) { return updateWelcomeSettings(context,{[Key.WELCOME_COLOR]:color}); }
async function previewWelcomeEmbed(context) { const config=await context.settings.get(context.guildId); await context.envelope.transport.reply({view:{content:config[Key.WELCOME_MESSAGE],embed:{color:config[Key.WELCOME_COLOR],description:config[Key.WELCOME_MESSAGE]},components:[]},ephemeral:true}); }
module.exports={toggleWelcomeEmbed,setWelcomeEmbedColor,previewWelcomeEmbed};
