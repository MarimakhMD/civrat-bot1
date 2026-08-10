"use strict";
async function handleCaptchaEvent({guild,config,action,memberId,roleId,mapper,service,delivery}){if(!config.logs_enabled)return null;const entry=mapper.map({guildId:guild.id,channelKey:"log_moderation_channel_id",category:"moderation",action,title:`logs.${action}`,details:{memberId,roleId,result:action}});return delivery.deliver({...entry,channelId:service.resolveDestination(entry,config)});}
module.exports={handleCaptchaEvent};
