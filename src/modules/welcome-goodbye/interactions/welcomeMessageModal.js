"use strict";
const { updateWelcomeSettings } = require("./updateWelcomeSettings");
const { WelcomeGoodbyeConfigKey: Key, WelcomeGoodbyeComponentId: Id } = require("../configuration/welcomeGoodbyeConstants");
const MessageFieldId = "message";
function openWelcomeMessageModal(context) { return context.envelope.transport.showModal({customId:Id.WELCOME_MESSAGE,title:context.t("welcomeGoodbye.welcomeMessageTitle"),fields:[{id:MessageFieldId,label:context.t("welcomeGoodbye.welcomeMessageLabel"),value:context.config?.[Key.WELCOME_MESSAGE]||"",required:true}]}); }
async function submitWelcomeMessage(context) { return updateWelcomeSettings(context,{[Key.WELCOME_MESSAGE]:context.envelope.fields?.[MessageFieldId]||""}); }
module.exports={openWelcomeMessageModal,submitWelcomeMessage,MessageFieldId};
