"use strict";
const {handleModerationEvent}=require("../events/handleModerationEvent");
async function deliverModerationLog({guild,config,action,targetId,runtime}){return handleModerationEvent({guild,config,action,targetId,mapper:runtime.mapper,service:runtime.service,delivery:runtime.delivery});}
module.exports={deliverModerationLog};
