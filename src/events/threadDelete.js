const { guildConfigService } = require("../services/guildConfig");
const { getLogsRuntime } = require("../modules/logs/runtime/getLogsRuntime");
module.exports={name:"threadDelete",once:false,async execute(thread){const config=await guildConfigService.getGuildConfig(thread.guild.id);await getLogsRuntime().handleChannelEvent({channel:thread,config,action:"thread_deleted"});}};
