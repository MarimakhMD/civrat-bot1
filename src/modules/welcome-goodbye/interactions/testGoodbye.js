"use strict";
const { WelcomeDeliveryService } = require("../services/WelcomeDeliveryService");
const { WelcomeTemplateRenderer, defaultPlaceholderProviders } = require("../services/WelcomeTemplateRenderer");
const { GoodbyeDeliveryError } = require("../services/GoodbyeDeliveryError");
const { WelcomeGoodbyeConfigKey: Key } = require("../configuration/welcomeGoodbyeConstants");
async function testGoodbye(context) { const config=await context.settings.get(context.guildId);if(!config[Key.GOODBYE_ENABLED])throw GoodbyeDeliveryError("goodbyeDisabled",{guildId:context.guildId});if(!config[Key.GOODBYE_CHANNEL])throw GoodbyeDeliveryError("goodbyeChannelMissing",{guildId:context.guildId});const delivery=new WelcomeDeliveryService({renderer:new WelcomeTemplateRenderer({providers:defaultPlaceholderProviders()}),logService:context.deliveryLogService});try{await delivery.goodbye({guildId:context.guildId},config,context.envelope.transport);}catch(error){throw GoodbyeDeliveryError("goodbyeChannelUnavailable",{guildId:context.guildId,cause:error});}context.adminLogService?.record({action:"goodbye_test_sent",guildId:context.guildId,actorId:context.userId});await context.envelope.transport.reply({view:{content:context.t("welcomeGoodbye.testGoodbyeSent"),components:[]},ephemeral:true});}
module.exports={testGoodbye};
