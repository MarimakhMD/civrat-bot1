const { getLogsRuntime } = require("../modules/logs/runtime/getLogsRuntime");
module.exports={name:"messageUpdate",once:false,async execute(oldMessage,newMessage){try{if(!newMessage.guild||newMessage.author?.bot||oldMessage.content===newMessage.content)return;await getLogsRuntime().handleMessageUpdated(newMessage);}catch{}}};
