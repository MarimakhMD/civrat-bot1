const { guildConfigService } = require("../services/guildConfig");
const { getLogsRuntime } = require("../modules/logs/runtime/getLogsRuntime");
module.exports={name:"channelUpdate",once:false,async execute(oldChannel,newChannel){try{if(!newChannel.guild||oldChannel.name===newChannel.name)return;const config=await guildConfigService.getGuildConfig(newChannel.guild.id);await getLogsRuntime().handleChannelEvent({channel:newChannel,config,action:"channel_updated"});}catch{}}};
