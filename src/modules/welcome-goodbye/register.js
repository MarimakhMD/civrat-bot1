"use strict";
const { previewWelcomeImage } = require("./image/pipeline/previewWelcomeImage");
const { PermissionName } = require("../../core/permissions");
const { EntitlementDecision, EntitlementFeature, premiumRequiredView } = require("../../core/entitlements");
const { WelcomeGoodbyeComponentId: Id, WelcomeGoodbyeConfigKey: Key } = require("./configuration/welcomeGoodbyeConstants");
const { settingsView, welcomeView, goodbyeView } = require("./interactions/welcomeGoodbyeViews");
const { toggleWelcome } = require("./interactions/updateWelcomeSettings");
const { openGoodbyeEmbedColorModal, submitGoodbyeEmbedColor } = require("./interactions/goodbyeEmbedColorModal");
const { toggleGoodbyeEmbed, previewGoodbyeEmbed } = require("./interactions/configureGoodbyeEmbed");
const { toggleGoodbye, useWelcomeChannelForGoodbye } = require("./interactions/configureGoodbye");
const { selectWelcomeGoodbyeChannel } = require("./interactions/selectWelcomeGoodbyeChannel");
const { openWelcomeMessageModal, submitWelcomeMessage } = require("./interactions/welcomeMessageModal");
const { openGoodbyeMessageModal, submitGoodbyeMessage } = require("./interactions/goodbyeMessageModal");
const { toggleWelcomeEmbed, previewWelcomeEmbed } = require("./interactions/configureWelcomeEmbed");
const { openWelcomeEmbedColorModal, submitWelcomeEmbedColor } = require("./interactions/welcomeEmbedColorModal");
const { toggleWelcomeDm } = require("./interactions/configureWelcomeDm");
const { toggleWelcomeImage } = require("./interactions/configureWelcomeImage");
const { openWelcomeImageView, showWelcomeImageUploadHelp, removeWelcomeImage } = require("./interactions/welcomeImageActions");
const { uploadWelcomeImage } = require("./interactions/welcomeImageUpload");
const { resolveWelcomeImageTemplate } = require("./services/welcomeImageResource");
const { buildWelcomeCardMember, buildWelcomeCardSubtitle } = require("./services/welcomeCardMember");
const { openWelcomeDmMessageModal, submitWelcomeDmMessage } = require("./interactions/welcomeDmMessageModal");
const { testWelcome } = require("./interactions/testWelcome");
const { testWelcomeDm } = require("./interactions/testWelcomeDm");
const { selectWelcomeTemplate } = require("./interactions/selectWelcomeTemplate");
const { previewGoodbye } = require("./interactions/previewGoodbye");
const { testGoodbye } = require("./interactions/testGoodbye");
const { WelcomeAdminAction } = require("./services/WelcomeAdminLogService");
function registerWelcomeGoodbye({registry,service,adminLogService=null,settingsHome=null,imagePipeline=null,templateRegistry=null,entitlementService=null,imageStore=null,resourceCache=null,logger=null}) { const permissions={allOf:[PermissionName.MANAGE_GUILD]}; const update=async(c)=>c.envelope.transport.update({view:settingsView({t:c.t,config:await service.get(c.guildId)})}); const log=(action,c)=>adminLogService?.record({action,guildId:c.guildId,actorId:c.userId});
  // Contexte enrichi pour la sous-vue « Image Welcome » et /welcomeimage :
  // entitlement, stockage et pipeline y sont injectés une seule fois.
  const imageContext=(c)=>({...c,settings:service,entitlementService,imageStore,resourceCache,imagePipeline,templateRegistry,adminLogService,logger});
  registry.registerButton({customId:Id.PREVIEW_WELCOME_IMAGE,permissions,execute:async c=>{
    // 4E/E2 — condition 1/2 : le TOGGLE `welcome_image_enabled`.
    //
    // Lu AVANT l'entitlement, pour deux raisons : le motif affiché doit être le
    // bon (« image désactivée » et non « Premium requis »), et un backend
    // Premium injoignable ne doit pas être consulté pour une image que l'admin
    // a éteinte. Comparaison STRICTE à `true` : `undefined`, `null` et toute
    // valeur non booléenne comptent comme désactivé (fail-closed), exactement
    // comme dans WelcomeDeliveryService — une seule règle aux deux endroits.
    const config=await service.get(c.guildId);
    if(config?.[Key.WELCOME_IMAGE_ENABLED]!==true){
      return c.envelope.transport.reply({view:{content:c.t("welcomeGoodbye.welcomeImageDisabled"),components:[]},ephemeral:true});
    }
    // Condition 2/2 : l'entitlement WELCOME_IMAGE. Les deux sont cumulatives.
    const ent=entitlementService
      ? await entitlementService.requireFeature({guildId:c.guildId,feature:EntitlementFeature.WELCOME_IMAGE})
      : {ok:false,granted:false,code:EntitlementDecision.UNAVAILABLE};
    if(!ent.granted){return c.envelope.transport.reply({view:premiumRequiredView(c.t,{decision:ent.code}),ephemeral:true});}
    const baseTemplate=(templateRegistry&&(templateRegistry.get(config[Key.WELCOME_TEMPLATE])||templateRegistry.get("template-1")))||null;
    // APERÇU = RENDU RÉEL : l'image personnalisée est résolue par la MÊME
    // fonction que #buildCardFiles, avec la décision d'entitlement déjà obtenue
    // ci-dessus (donc déjà gated). L'aperçu ne peut pas différer de la carte
    // réellement envoyée.
    const template=await resolveWelcomeImageTemplate({baseTemplate,config,guildId:c.guildId,entitlement:ent,imageStore,resourceCache});
    const member={...buildWelcomeCardMember(c.envelope.discordMember),guildId:c.guildId,userId:c.userId};
    const subtitleText=buildWelcomeCardSubtitle(config,member);
    return previewWelcomeImage(c,imagePipeline,{member,subtitleText,template});
  }});
  registry.registerButton({customId:Id.SECTION,permissions,execute:update});
  registry.registerButton({customId:Id.OPEN_WELCOME,permissions,execute:async c=>c.envelope.transport.update({view:welcomeView({t:c.t,config:await service.get(c.guildId)})})});
  registry.registerButton({customId:Id.OPEN_GOODBYE,permissions,execute:async c=>c.envelope.transport.update({view:goodbyeView({t:c.t,config:await service.get(c.guildId)})})});
  registry.registerButton({customId:Id.TOGGLE_WELCOME,permissions,execute:async c=>{const config=await toggleWelcome({...c,settings:service});log(config[Key.WELCOME_ENABLED]?WelcomeAdminAction.ENABLED:WelcomeAdminAction.DISABLED,c);return config;}});
  registry.registerSelectMenu({customId:Id.WELCOME_CHANNEL,permissions,execute:async c=>{const config=await selectWelcomeGoodbyeChannel({...c,settings:service,envelope:{...c.envelope,customId:Id.WELCOME_CHANNEL}});log(WelcomeAdminAction.CHANNEL_CHANGED,c);return config;}});
  registry.registerButton({customId:Id.WELCOME_MESSAGE,permissions,execute:async c=>openWelcomeMessageModal({...c,settings:service,config:await service.get(c.guildId)})});
  registry.registerModal({customId:Id.WELCOME_MESSAGE,permissions,execute:async c=>{const config=await submitWelcomeMessage({...c,settings:service,envelope:{...c.envelope,fields:c.envelope.modalValues}});log("welcome_message_changed",c);return config;}});
  registry.registerButton({customId:Id.TOGGLE_WELCOME_EMBED,permissions,execute:async c=>{const config=await toggleWelcomeEmbed({...c,settings:service});log(config[Key.WELCOME_EMBED]?WelcomeAdminAction.EMBED_ENABLED:WelcomeAdminAction.EMBED_DISABLED,c);return config;}});
  registry.registerButton({customId:Id.WELCOME_EMBED_COLOR,permissions,execute:async c=>openWelcomeEmbedColorModal({...c,settings:service,config:await service.get(c.guildId)})});
  registry.registerModal({customId:Id.WELCOME_EMBED_COLOR,permissions,execute:async c=>{const config=await submitWelcomeEmbedColor({...c,settings:service,envelope:{...c.envelope,fields:c.envelope.modalValues}});log(WelcomeAdminAction.EMBED_COLOR_CHANGED,c);return config;}});
  registry.registerButton({customId:Id.PREVIEW_WELCOME_EMBED,permissions,execute:async c=>previewWelcomeEmbed({...c,settings:service})});
  registry.registerButton({customId:Id.TOGGLE_WELCOME_DM,permissions,execute:async c=>{const config=await toggleWelcomeDm({...c,settings:service});log(config[Key.WELCOME_DM]?WelcomeAdminAction.DM_ENABLED:WelcomeAdminAction.DM_DISABLED,c);return config;}});
  // PHASE 2 (UI-2) — contrôle UI de `welcome_image_enabled`. La gate Premium
  // reste appliquée à l'activation PAR toggleWelcomeImage (aucun contournement) :
  // en cas de refus, aucune écriture n'a lieu et la fonction renvoie la réponse
  // d'erreur Premium au lieu d'une config — d'où le test `in result` avant de
  // journaliser, pour ne pas tracer une désactivation qui n'a pas eu lieu.
  registry.registerButton({customId:Id.TOGGLE_WELCOME_IMAGE,permissions,execute:async c=>{const result=await toggleWelcomeImage({...c,settings:service,entitlementService});if(result&&typeof result==="object"&&Key.WELCOME_IMAGE_ENABLED in result){log(result[Key.WELCOME_IMAGE_ENABLED]===true?WelcomeAdminAction.IMAGE_ENABLED:WelcomeAdminAction.IMAGE_DISABLED,c);}return result;}});
  registry.registerButton({customId:Id.WELCOME_DM_MESSAGE,permissions,execute:async c=>openWelcomeDmMessageModal({...c,settings:service,config:await service.get(c.guildId)})});
  registry.registerModal({customId:Id.WELCOME_DM_MESSAGE,permissions,execute:async c=>{const config=await submitWelcomeDmMessage({...c,settings:service,envelope:{...c.envelope,fields:c.envelope.modalValues}});log(WelcomeAdminAction.DM_MESSAGE_CHANGED,c);return config;}});
  registry.registerButton({customId:Id.TEST_WELCOME_DM,permissions,execute:async c=>testWelcomeDm({...c,settings:service,adminLogService})});
  registry.registerButton({customId:Id.TEST_WELCOME,permissions,execute:async c=>testWelcome({...c,settings:service,adminLogService})});
  registry.registerSelectMenu({customId:Id.TEMPLATE_SELECT,permissions,execute:async c=>{const config=await selectWelcomeTemplate({...c,settings:service});log(WelcomeAdminAction.TEMPLATE_CHANGED,c);return config;}});
  registry.registerButton({customId:Id.TOGGLE_GOODBYE,permissions,execute:async c=>{const config=await toggleGoodbye({...c,settings:service});log(config[Key.GOODBYE_ENABLED]?WelcomeAdminAction.GOODBYE_ENABLED:WelcomeAdminAction.GOODBYE_DISABLED,c);return config;}}); registry.registerButton({customId:Id.SAME_CHANNEL,permissions,execute:async c=>{const config=await useWelcomeChannelForGoodbye({...c,settings:service});log(WelcomeAdminAction.SAME_CHANNEL_APPLIED,c);return config;}}); registry.registerSelectMenu({customId:Id.GOODBYE_CHANNEL_SELECT,permissions,execute:async c=>{const config=await selectWelcomeGoodbyeChannel({...c,settings:service,envelope:{...c.envelope,customId:Id.GOODBYE_CHANNEL}});log(WelcomeAdminAction.GOODBYE_CHANNEL_CHANGED,c);return config;}}); registry.registerButton({customId:Id.GOODBYE_MESSAGE,permissions,execute:async c=>openGoodbyeMessageModal({...c,settings:service,config:await service.get(c.guildId)})}); registry.registerModal({customId:Id.GOODBYE_MESSAGE,permissions,execute:async c=>{const config=await submitGoodbyeMessage({...c,settings:service,envelope:{...c.envelope,fields:c.envelope.modalValues}});log("goodbye_message_changed",c);return config;}}); registry.registerButton({customId:Id.TOGGLE_GOODBYE_EMBED,permissions,execute:async c=>{const config=await toggleGoodbyeEmbed({...c,settings:service});log(config[Key.GOODBYE_EMBED]?WelcomeAdminAction.GOODBYE_EMBED_ENABLED:WelcomeAdminAction.GOODBYE_EMBED_DISABLED,c);return config;}}); registry.registerButton({customId:Id.GOODBYE_EMBED_COLOR,permissions,execute:async c=>openGoodbyeEmbedColorModal({...c,settings:service,config:await service.get(c.guildId)})}); registry.registerModal({customId:Id.GOODBYE_EMBED_COLOR,permissions,execute:async c=>{const config=await submitGoodbyeEmbedColor({...c,settings:service,envelope:{...c.envelope,fields:c.envelope.modalValues}});log(WelcomeAdminAction.GOODBYE_EMBED_COLOR_CHANGED,c);return config;}}); registry.registerButton({customId:Id.PREVIEW_GOODBYE_EMBED,permissions,execute:async c=>previewGoodbyeEmbed({...c,settings:service})}); registry.registerButton({customId:Id.PREVIEW_GOODBYE,permissions,execute:async c=>previewGoodbye({...c,settings:service})}); registry.registerButton({customId:Id.TEST_GOODBYE,permissions,execute:async c=>testGoodbye({...c,settings:service})}); registry.registerButton({customId:Id.OPEN_WELCOME_IMAGE,permissions,execute:async c=>openWelcomeImageView(imageContext(c))}); registry.registerButton({customId:Id.WELCOME_IMAGE_UPLOAD_HELP,permissions,execute:async c=>showWelcomeImageUploadHelp(imageContext(c))}); registry.registerButton({customId:Id.REMOVE_WELCOME_IMAGE,permissions,execute:async c=>{const result=await removeWelcomeImage(imageContext(c));log(result.removed?WelcomeAdminAction.IMAGE_REMOVED:WelcomeAdminAction.IMAGE_REMOVE_FAILED,c);return result;}}); registry.registerButton({customId:Id.WELCOME_IMAGE_HOME,permissions,execute:async c=>c.envelope.transport.update({view:welcomeView({t:c.t,config:await service.get(c.guildId)})})}); const welcomeImageCommand={name:"welcomeimage",description:"Upload a custom Welcome image (Premium)",permissions,options:[{type:"attachment",name:"image",description:"Image file",required:true}]}; registry.registerCommand({...welcomeImageCommand,execute:async c=>uploadWelcomeImage(imageContext(c))}); registry.registerButton({customId:Id.BACK,permissions,execute:settingsHome});
  // La définition est retournée pour que la composition l'inclue dans le
  // catalogue déployé (commandDefinitions), comme les autres modules.
  return {id:Id.SECTION,permissions,commands:[welcomeImageCommand]}; }
module.exports={registerWelcomeGoodbye};
// Image preview registration is intentionally kept with the existing Welcome module routes.
