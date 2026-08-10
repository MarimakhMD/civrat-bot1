const { getLogsRuntime } = require("../modules/logs/runtime/getLogsRuntime");
module.exports={name:"messageDelete",once:false,async execute(message){try{if(!message.guild||!message.author||message.author.bot)return;await getLogsRuntime().handleMessageDeleted(message);}catch{}}};
