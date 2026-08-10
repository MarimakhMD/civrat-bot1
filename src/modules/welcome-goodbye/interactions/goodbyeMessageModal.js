"use strict";
const { updateGoodbyeSettings } = require("./updateGoodbyeSettings");
const { WelcomeGoodbyeConfigKey: Key, WelcomeGoodbyeComponentId: Id } = require("../configuration/welcomeGoodbyeConstants");
const MessageFieldId = "message";
function openGoodbyeMessageModal(context) { return context.envelope.transport.showModal({customId:Id.GOODBYE_MESSAGE,title:context.t("welcomeGoodbye.goodbyeMessageTitle"),fields:[{id:MessageFieldId,label:context.t("welcomeGoodbye.goodbyeMessageLabel"),value:context.config?.[Key.GOODBYE_MESSAGE]||"",required:true}]}); }
async function submitGoodbyeMessage(context) { return updateGoodbyeSettings(context,{[Key.GOODBYE_MESSAGE]:context.envelope.fields?.[MessageFieldId]||""},"welcomeGoodbye.goodbyeMessageSaved"); }
module.exports={openGoodbyeMessageModal,submitGoodbyeMessage,MessageFieldId};
