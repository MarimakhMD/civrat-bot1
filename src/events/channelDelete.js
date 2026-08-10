const { guildConfigService } = require("../services/guildConfig");
const securityService = require("../services/securityService");
const { getLogsRuntime } = require("../modules/logs/runtime/getLogsRuntime");
module.exports={name:"channelDelete",once:false,async execute(channel){try{if(!channel.guild)return;const config=await guildConfigService.getGuildConfig(channel.guild.id);if(config.logs_enabled)await securityService.recordNukeAction(channel.guild,config,12,"channels");await getLogsRuntime().handleChannelEvent({channel,config,action:"channel_deleted"});}catch{}}};
