"use strict";
const { updateWelcomeSettings } = require("./updateWelcomeSettings");
const { WelcomeGoodbyeConfigKey: Key, WelcomeGoodbyeComponentId: Id } = require("../configuration/welcomeGoodbyeConstants");
const MessageFieldId = "message";
function openWelcomeDmMessageModal(context) { return context.envelope.transport.showModal({customId:Id.WELCOME_DM_MESSAGE,title:context.t("welcomeGoodbye.dmMessageTitle"),fields:[{id:MessageFieldId,label:context.t("welcomeGoodbye.dmMessageLabel"),value:context.config?.[Key.WELCOME_DM_MESSAGE]||"",required:false}]}); }
async function submitWelcomeDmMessage(context) { return updateWelcomeSettings(context,{[Key.WELCOME_DM_MESSAGE]:context.envelope.fields?.[MessageFieldId]||null}); }
module.exports={openWelcomeDmMessageModal,submitWelcomeDmMessage,MessageFieldId};
