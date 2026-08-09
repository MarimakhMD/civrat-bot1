"use strict";
async function handleTicketEvent({guild,config,action,ticketChannelId,userId=null,mapper,service,delivery}){if(!config.logs_enabled)return null;const entry=mapper.map({guildId:guild.id,channelKey:"log_moderation_channel_id",category:"moderation",action,title:`logs.${action}`,details:{ticketChannelId,userId,action,result:action}});return delivery.deliver({...entry,channelId:service.resolveDestination(entry,config)});}
module.exports={handleTicketEvent};
