"use strict";
const { CivratError }=require("../../../core/errors");function GoodbyeDeliveryError(translationKey,metadata={}){return new CivratError({code:"GOODBYE_DELIVERY_UNAVAILABLE",translationKey:`welcomeGoodbye.${translationKey}`,metadata,isUserSafe:true});}module.exports={GoodbyeDeliveryError};
