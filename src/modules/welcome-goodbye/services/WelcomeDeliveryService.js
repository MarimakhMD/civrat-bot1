"use strict";
const { normalizeWelcomeDeliveryError } = require("./WelcomeDeliveryError");
const { buildWelcomeCardRequest } = require("../image/pipeline/buildWelcomeCardRequest");
const { resolveWelcomeImageTemplate } = require("./welcomeImageResource");
const { resolveBaseTemplate } = require("../rendering/WelcomeTemplateRegistry");
const { EntitlementDecision, EntitlementFeature } = require("../../../core/entitlements");
const { WelcomeGoodbyeConfigKey: Key, WelcomeGoodbyeLogType: LogType, WelcomeCardSkipReason: SkipReason } = require("../configuration/welcomeGoodbyeConstants");
// PHASE 2 (B5/B6) — défauts localisés et chemin de rendu unique. La logique
// Premium (carte Welcome) ci-dessous n'est PAS modifiée.
const { resolveConfiguredMessage, resolveWelcomeDmMessage } = require("../configuration/welcomeGoodbyeDefaults");
const { renderDeliveryPayload } = require("./welcomePayload");
const DEFAULT_TEMPLATE_ID = "template-1";
class WelcomeDeliveryService {
  // Phase 2 (P6) — `entitlementService` rejoint la composition. Il reste
  // optionnel pour ne casser aucun appelant existant, mais son ABSENCE est
  // traitée comme un backend indisponible (fail-closed) : sans preuve
  // d'entitlement, la carte Premium n'est pas générée.
  constructor({renderer,logService=null,imagePipeline=null,templateRegistry=null,entitlementService=null,imageStore=null,resourceCache=null,logger=null}){this.renderer=renderer;this.logService=logService;this.imagePipeline=imagePipeline;this.templateRegistry=templateRegistry;this.entitlementService=entitlementService;this.imageStore=imageStore;this.resourceCache=resourceCache;this.logger=logger;}
  async welcome(member,config,transport,options={}){return this.#deliver(member,config,transport,{enabled:Key.WELCOME_ENABLED,channel:Key.WELCOME_CHANNEL,message:Key.WELCOME_MESSAGE,embed:Key.WELCOME_EMBED,color:Key.WELCOME_COLOR,type:LogType.WELCOME_SENT,kind:"welcome",image:true},options);}
  async goodbye(member,config,transport,options={}){return this.#deliver(member,config,transport,{enabled:Key.GOODBYE_ENABLED,channel:Key.GOODBYE_CHANNEL,message:Key.GOODBYE_MESSAGE,embed:Key.GOODBYE_EMBED,color:Key.GOODBYE_COLOR,type:LogType.GOODBYE_SENT,kind:"goodbye",image:false},options);}
  // PHASE 2 (B6) — le DM n'est JAMAIS envoyé vide : message DM configuré, sinon
  // message Welcome configuré, sinon défaut dans la langue de la guilde. Un
  // contenu absent ou vide ne peut donc plus empêcher la tentative de DM.
  async dm(member,config,transport){
    if(!config[Key.WELCOME_DM])return null;
    const message=resolveWelcomeDmMessage(config);
    const content=this.renderer.render(message,member);
    try{await transport.sendDirectMessage(member.userId,{content});return this.logService?.delivery({type:LogType.WELCOME_DM_SENT,guildId:member.guildId})||{type:LogType.WELCOME_DM_SENT};}catch(error){this.logService?.failure({type:LogType.DELIVERY_UNAVAILABLE,guildId:member.guildId,reason:error.reason||error.message});throw normalizeWelcomeDeliveryError(error,{guildId:member.guildId});}
  }
  // PHASE 2 (B5/B6) — le payload est produit par le chemin de rendu UNIQUE
  // (`welcomePayload`), le même que celui des aperçus et des boutons de test.
  async #deliver(member,config,transport,definition,{dryRun=false}={}){
    if(!config[definition.enabled])return null;
    const message=resolveConfiguredMessage(config,definition.message,definition.kind);
    const payload=renderDeliveryPayload({renderer:this.renderer,message,context:member,embedEnabled:Boolean(config[definition.embed]),color:config[definition.color]});
    if(dryRun)return payload;
    // Card attachment: Welcome only, never Goodbye. Card generation failures
    // must never block the text/embed delivery.
    if(definition.image===true){const files=await this.#buildCardFiles(member,config,payload.content);if(files)payload.files=files;}
    try{const result=await transport.sendChannelMessage(config[definition.channel],payload);return this.logService?.delivery({type:definition.type,guildId:member.guildId})||result;}catch(error){this.logService?.failure({type:LogType.DELIVERY_UNAVAILABLE,guildId:member.guildId,reason:error.reason||error.message});throw normalizeWelcomeDeliveryError(error,{guildId:member.guildId});}}
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
    // 4E/E2 — condition 1/2 : le TOGGLE `welcome_image_enabled`.
    //
    // Vérifié AVANT l'entitlement, pour deux raisons : une image désactivée par
    // l'admin ne doit pas provoquer d'appel au backend Premium, et le motif
    // journalisé doit dire « désactivée » plutôt que « Premium requis ».
    //
    // Comparaison STRICTE à `true` : `undefined` (ligne ou colonne absente),
    // `null` et toute valeur non booléenne comptent comme DÉSACTIVÉ. C'est le
    // fail-closed déjà appliqué à l'entitlement — une valeur douteuse n'accorde
    // jamais une fonctionnalité Premium.
    if(config?.[Key.WELCOME_IMAGE_ENABLED]!==true){
      this.logService?.delivery({type:LogType.WELCOME_CARD_SKIPPED,guildId:member.guildId,reason:SkipReason.IMAGE_DISABLED});
      return null;
    }
    // Condition 2/2 : l'entitlement WELCOME_IMAGE. Les deux conditions sont
    // cumulatives — aucune ne suffit seule.
    const entitlement=await this.#resolveCardEntitlement(member.guildId);
    if(!entitlement.granted){
      // Une guilde Free n'est pas une anomalie : journalisée en info. Un
      // backend injoignable en est une : journalisée en warn. Les deux
      // coupent la carte (panne backend ≠ droit accordé).
      const event={type:LogType.WELCOME_CARD_SKIPPED,guildId:member.guildId,reason:entitlement.code};
      if(entitlement.code===EntitlementDecision.UNAVAILABLE)this.logService?.failure(event);else this.logService?.delivery(event);
      return null;
    }
    // Restriction guildId : un gabarit réservé à d'autres guildes (template-civrat)
    // n'est jamais livré ici — repli sur le gabarit par défaut, même s'il était
    // persisté par erreur pour cette guilde.
    const baseTemplate=resolveBaseTemplate(this.templateRegistry,config[Key.WELCOME_TEMPLATE],member.guildId)||this.templateRegistry.get(DEFAULT_TEMPLATE_ID);
    if(!baseTemplate?.design)return null;
    // Image Welcome personnalisée (Premium) — résolue ICI, c'est-à-dire APRÈS
    // les deux garde-fous ci-dessus (toggle puis entitlement). Elle est donc
    // structurellement gated : aucune image ne peut être servie à une guilde
    // Free, et les trois motifs WELCOME_IMAGE_DISABLED / PREMIUM_REQUIRED /
    // ENTITLEMENT_UNAVAILABLE sont déjà émis en amont, inchangés.
    //
    // `resolveWelcomeImageTemplate` DÉRIVE un template sans jamais muter le
    // registre global, et renvoie `baseTemplate` dès qu'un maillon manque
    // (store indisponible, objet absent, clé d'une autre guilde, image
    // illisible) : le Welcome n'est jamais bloqué par l'image personnalisée.
    const template=await resolveWelcomeImageTemplate({baseTemplate,config,guildId:member.guildId,entitlement,imageStore:this.imageStore,resourceCache:this.resourceCache,logger:this.logger});
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
