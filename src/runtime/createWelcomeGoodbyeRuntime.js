"use strict";
const {WelcomeGoodbyeService}=require("../modules/welcome-goodbye/services/WelcomeGoodbyeService");
const {WelcomeGoodbyeLogService}=require("../modules/welcome-goodbye/services/WelcomeGoodbyeLogService");
const {WelcomeTemplateRegistry}=require("../modules/welcome-goodbye/rendering/WelcomeTemplateRegistry");
const {WelcomeImageRenderer}=require("../modules/welcome-goodbye/image/rendering/WelcomeImageRenderer");
const {WelcomeImagePipeline}=require("../modules/welcome-goodbye/image/pipeline/WelcomeImagePipeline");
const {WelcomeDeliveryService}=require("../modules/welcome-goodbye/services/WelcomeDeliveryService");
const {handleMemberAdded}=require("../modules/welcome-goodbye/events/handleMemberAdded");
const {handleMemberRemoved}=require("../modules/welcome-goodbye/events/handleMemberRemoved");
const {adaptGuildMember}=require("../adapters/discord/DiscordGuildMemberAdapter");
const {DiscordWelcomeGoodbyeTransport}=require("../adapters/discord/DiscordWelcomeGoodbyeTransport");
// PHASE 2 — renderer unique (B5) et langue de la guilde (B7).
const {createWelcomeRenderer}=require("../modules/welcome-goodbye/services/welcomePayload");
const {createWelcomeImageStorage}=require("../modules/welcome-goodbye/runtime/createWelcomeImageStorage");
const {resolveWelcomeGoodbyeLanguage}=require("../modules/welcome-goodbye/configuration/welcomeGoodbyeDefaults");

function createWelcomeGoodbyeRuntime({guildConfigResolver,logger=null,entitlementService=null}){
  // Phase 2 (P6) — la carte Welcome est une fonctionnalité Premium. La
  // composition injecte le singleton EntitlementService du processus : le
  // MÊME que /settings, l'aperçu Welcome et le panneau Admin, afin qu'il
  // n'existe qu'une seule autorité Premium (aucun cache, aucun resolveur
  // secondaire). Le require est paresseux : il évite un cycle de composition
  // au chargement et laisse les tests injecter un double.
  // En cas d'indisponibilité, `entitlementService` reste null et
  // WelcomeDeliveryService applique son repli fail-closed (ENTITLEMENT_UNAVAILABLE).
  //
  // PHASE 2 — cette logique Premium est inchangée.
  const entitlement=entitlementService||(()=>{try{return require("./getEntitlementService").getEntitlementService();}catch{return null;}})();
  const service=new WelcomeGoodbyeService({guildConfigResolver});
  const logService=new WelcomeGoodbyeLogService({logger});
  const templateRegistry=new WelcomeTemplateRegistry();
  templateRegistry.discover();
  // Image Welcome personnalisée (Premium) : bucket Supabase Storage privé.
  // Hors ligne / sans credentials, `imageStore.available` est faux et la
  // livraison retombe sur le template standard (fail-closed).
  const {imageStore:welcomeImageStore,resourceCache:welcomeImageCache}=createWelcomeImageStorage({logger});
  const imageRenderer=new WelcomeImageRenderer({resourceCache:welcomeImageCache});
  const imagePipeline=new WelcomeImagePipeline({renderer:imageRenderer,logService});
  const delivery=new WelcomeDeliveryService({renderer:createWelcomeRenderer(),logService,imagePipeline,templateRegistry,entitlementService:entitlement,imageStore:welcomeImageStore,resourceCache:welcomeImageCache,logger});

  // PHASE 2 (B7/B10) — la configuration est lue UNE fois ici : elle fournit la
  // langue de la guilde, qui pilote le format des dates (`{joinDate}`,
  // `{accountAge}`, `{date}`, `{time}`), et elle est transmise aux handlers pour
  // éviter une seconde lecture. Le filtre bot est appliqué AVANT toute lecture :
  // l'arrivée d'un bot ne charge plus la configuration de la guilde.
  async function run(handler,member){
    if(member&&member.user&&member.user.bot===true)return null;
    const config=await service.get(member.guild.id);
    return handler({
      member:adaptGuildMember(member,{language:resolveWelcomeGoodbyeLanguage(config)}),
      config,
      service,
      delivery,
      transport:new DiscordWelcomeGoodbyeTransport(member),
    });
  }

  const invoke=(handler,member)=>run(handler,member).catch(error=>logger?.error?.("Welcome & Goodbye delivery failed",{error:error.message,guildId:member.guild.id}));

  return Object.freeze({
    handleMemberAdded:(member)=>invoke(handleMemberAdded,member),
    handleMemberRemoved:(member)=>invoke(handleMemberRemoved,member),
  });
}
module.exports={createWelcomeGoodbyeRuntime};
