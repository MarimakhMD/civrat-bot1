"use strict";
const { WelcomeImageRequest }=require("../contracts/WelcomeImageRequest");
const { buildWelcomeCardRequest }=require("./buildWelcomeCardRequest");

// Without a template manifest the historical minimal preview is produced;
// with a template (selected by the guild config) the real card is rendered,
// including the member avatar and the placeholder-resolved subtitle.
async function previewWelcomeImage(context,pipeline,{member=null,subtitleText=null,template=null}={}){
  let request;
  if(template&&template.design&&member){
    request=buildWelcomeCardRequest({member,subtitleText,template,locale:context.locale});
  }else{
    request=new WelcomeImageRequest({guildId:context.guildId,userId:context.userId,locale:context.locale,textElements:[{id:"primary",content:context.t("welcomeGoodbye.title"),color:"#ffffff"}]});
  }
  const image=await pipeline.generate(request,template||undefined);
  await context.envelope.transport.replyImagePreview({image,content:context.t("welcomeGoodbye.imagePreviewGenerated"),ephemeral:true});
}
module.exports={previewWelcomeImage};
