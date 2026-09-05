"use strict";
const { normalizeWelcomeDeliveryError } = require("./WelcomeDeliveryError");
const { buildWelcomeCardRequest } = require("../image/pipeline/buildWelcomeCardRequest");
const { EntitlementDecision, EntitlementFeature } = require("../../../core/entitlements");
const { WelcomeGoodbyeConfigKey: Key, WelcomeGoodbyeLogType: LogType } = require("../configuration/welcomeGoodbyeConstants");
const DEFAULT_TEMPLATE_ID = "template-1";
class WelcomeDeliveryService {
  // Phase 2 (P6) — `entitlementService` rejoint la composition. Il reste
  // optionnel pour ne casser aucun appelant existant, mais son ABSENCE est
  // traitée comme un backend indisponible (fail-closed) : sans preuve
  // d'entitlement, la carte Premium n'est pas générée.
  constructor({renderer,logService=null,imagePipeline=null,templateRegistry=null,entitlementService=null}){this.renderer=renderer;this.logService=logService;this.imagePipeline=imagePipeline;this.templateRegistry=templateRegistry;this.entitlementService=entitlementService;}
  async welcome(member,config,transport){return this.#deliver(member,config,transport,{enabled:Key.WELCOME_ENABLED,channel:Key.WELCOME_CHANNEL,message:Key.WELCOME_MESSAGE,embed:Key.WELCOME_EMBED,color:Key.WELCOME_COLOR,type:LogType.WELCOME_SENT,image:true});}
  async goodbye(member,config,transport,options={}){return this.#deliver(member,config,transport,{enabled:Key.GOODBYE_ENABLED,channel:Key.GOODBYE_CHANNEL,message:Key.GOODBYE_MESSAGE,embed:Key.GOODBYE_EMBED,color:Key.GOODBYE_COLOR,type:LogType.GOODBYE_SENT,image:false},options);}
  async dm(member,config,transport){if(!config[Key.WELCOME_DM])return null;const content=this.renderer.render(config[Key.WELCOME_DM_MESSAGE]||config[Key.WELCOME_MESSAGE],member);try{await transport.sendDirectMessage(member.userId,{content});return this.logService?.delivery({type:LogType.WELCOME_DM_SENT,guildId:member.guildId})||{type:LogType.WELCOME_DM_SENT};}catch(error){this.logService?.failure({type:LogType.DELIVERY_UNAVAILABLE,guildId:member.guildId,reason:error.message});throw normalizeWelcomeDeliveryError(error,{guildId:member.guildId});}}
  async #deliver(member,config,transport,definition,{dryRun=false}={}){if(!config[definition.enabled])return null;const content=this.renderer.render(config[definition.message],member);const payload={content,embed:config[definition.embed]?{color:config[definition.color],description:content}:null};if(dryRun)return payload;
    // Card attachment: Welcome only, never Goodbye. Card generation failures
    // must never block the text/embed delivery.
    if(definition.image===true){const files=await this.#buildCardFiles(member,config,content);if(files)payload.files=files;}
    try{const result=await transport.sendChannelMessage(config[definition.channel],payload);return this.logService?.delivery({type:definition.type,guildId:member.guildId})||result;}catch(error){this.logService?.failure({type:LogType.DELIVERY_UNAVAILABLE,guildId:member.guildId,reason:error.message});throw normalizeWelcomeDeliveryError(error,{guildId:member.guildId});}}
  // Phase 2 (P6) — niveau réel de contrôle : la carte Welcome est une
  // fonctionnalité Premium (WELCOME_IMAGE). Le bouton d'aperçu était déjà
  // gardé (register.js), mais la LIVRAISON à chaque arrivée de membre ne
  // l'était pas : une guilde Free recevait l'image Premium. La règle est
  // désormais identique aux deux endroits — une seule source de vérité.
  //
  // Aucun message n'est renvoyé à l'utilisateur : ce chemin est événementiel
  // (pas d'interaction à laquelle répondre), donc aucune fuite de détail
  // technique n'est possible. La distinction PREMIUM_REQUIRED /
  // ENTITLEMENT_UNAVAILABLE est portée dans les journaux internes uniquement.
  async #resolveCardEntitlement(guildId){
    if(!this.entitlementService)return {ok:false,granted:false,code:EntitlementDecision.UNAVAILABLE};
    try{
      const decision=await this.entitlementService.requireFeature({guildId,feature:EntitlementFeature.WELCOME_IMAGE});
      return {ok:Boolean(decision?.ok),granted:decision?.granted===true,code:decision?.code||EntitlementDecision.UNAVAILABLE};
    }catch{
      return {ok:false,granted:false,code:EntitlementDecision.UNAVAILABLE};
    }
  }
  async #buildCardFiles(member,config,subtitleText){
    if(!this.imagePipeline||!this.templateRegistry)return null;
    const entitlement=await this.#resolveCardEntitlement(member.guildId);
    if(!entitlement.granted){
      // Une guilde Free n'est pas une anomalie : journalisée en info. Un
      // backend injoignable en est une : journalisée en warn. Les deux
      // coupent la carte (panne backend ≠ droit accordé).
      const event={type:LogType.WELCOME_CARD_SKIPPED,guildId:member.guildId,reason:entitlement.code};
      if(entitlement.code===EntitlementDecision.UNAVAILABLE)this.logService?.failure(event);else this.logService?.delivery(event);
      return null;
    }
    const template=this.templateRegistry.get(config[Key.WELCOME_TEMPLATE])||this.templateRegistry.get(DEFAULT_TEMPLATE_ID);
    if(!template?.design)return null;
    try{
      const request=buildWelcomeCardRequest({member,subtitleText,template});
      const image=await this.imagePipeline.generate(request,template);
      return [{attachment:image.buffer,name:"welcome-card.png"}];
    }catch(error){
      this.logService?.failure({type:LogType.DELIVERY_UNAVAILABLE,guildId:member.guildId,reason:`card:${error.message}`});
      return null;
    }
  }
}
module.exports={WelcomeDeliveryService};
