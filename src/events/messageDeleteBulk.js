const { getLogsRuntime } = require("../modules/logs/runtime/getLogsRuntime");
const guildConfigService = require("../services/guildConfig");
module.exports={name:"messageDeleteBulk",once:false,async execute(messages){const first=messages.first();if(!first?.guild)return;const config=await guildConfigService.getGuildConfig(first.guild.id);await getLogsRuntime().handleMessageBulkDeleted(messages,config);}};
