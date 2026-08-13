"use strict";
class WelcomeImagePipeline { constructor({renderer,theme,logService=null}){this.renderer=renderer;this.theme=theme;this.logService=logService;} async generate(request,asset=null){try{const payload=await this.renderer.render(request,asset||this.theme);this.logService?.delivery({type:"IMAGE_GENERATED",guildId:request.guildId});return payload;}catch(error){this.logService?.failure({type:"IMAGE_FAILED",guildId:request.guildId,reason:error.message});throw error;}} }
module.exports={WelcomeImagePipeline};
