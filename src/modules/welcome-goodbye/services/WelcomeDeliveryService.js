"use strict";
const { normalizeWelcomeDeliveryError } = require("./WelcomeDeliveryError");
const { WelcomeGoodbyeConfigKey: Key, WelcomeGoodbyeLogType: LogType } = require("../configuration/welcomeGoodbyeConstants");
class WelcomeDeliveryService {
  constructor({renderer,logService=null}){this.renderer=renderer;this.logService=logService;}
  async welcome(member,config,transport){return this.#deliver(member,config,transport,{enabled:Key.WELCOME_ENABLED,channel:Key.WELCOME_CHANNEL,message:Key.WELCOME_MESSAGE,embed:Key.WELCOME_EMBED,color:Key.WELCOME_COLOR,type:LogType.WELCOME_SENT});}
  async goodbye(member,config,transport,options={}){return this.#deliver(member,config,transport,{enabled:Key.GOODBYE_ENABLED,channel:Key.GOODBYE_CHANNEL,message:Key.GOODBYE_MESSAGE,embed:Key.GOODBYE_EMBED,color:Key.GOODBYE_COLOR,type:LogType.GOODBYE_SENT},options);}
  async dm(member,config,transport){if(!config[Key.WELCOME_DM])return null;const content=this.renderer.render(config[Key.WELCOME_DM_MESSAGE]||config[Key.WELCOME_MESSAGE],member);try{await transport.sendDirectMessage(member.userId,{content});return this.logService?.delivery({type:LogType.WELCOME_DM_SENT,guildId:member.guildId})||{type:LogType.WELCOME_DM_SENT};}catch(error){this.logService?.failure({type:LogType.DELIVERY_UNAVAILABLE,guildId:member.guildId,reason:error.message});throw normalizeWelcomeDeliveryError(error,{guildId:member.guildId});}}
  async #deliver(member,config,transport,definition,{dryRun=false}={}){if(!config[definition.enabled])return null;const content=this.renderer.render(config[definition.message],member);const payload={content,embed:config[definition.embed]?{color:config[definition.color],description:content}:null};if(dryRun)return payload;try{const result=await transport.sendChannelMessage(config[definition.channel],payload);return this.logService?.delivery({type:definition.type,guildId:member.guildId})||result;}catch(error){this.logService?.failure({type:LogType.DELIVERY_UNAVAILABLE,guildId:member.guildId,reason:error.message});throw normalizeWelcomeDeliveryError(error,{guildId:member.guildId});}}
}
module.exports={WelcomeDeliveryService};
