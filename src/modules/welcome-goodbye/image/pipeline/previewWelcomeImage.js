"use strict";
const { WelcomeImageRequest }=require("../contracts/WelcomeImageRequest");
async function previewWelcomeImage(context,pipeline){const request=new WelcomeImageRequest({guildId:context.guildId,userId:context.userId,locale:context.locale,textElements:[{id:"primary",content:context.t("welcomeGoodbye.title"),color:"#ffffff"}]});const image=await pipeline.generate(request);await context.envelope.transport.replyImagePreview({image,content:context.t("welcomeGoodbye.imagePreviewGenerated"),ephemeral:true});}
module.exports={previewWelcomeImage};
