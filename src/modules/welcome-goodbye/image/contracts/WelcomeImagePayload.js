"use strict";
class WelcomeImagePayload { constructor({buffer,contentType="image/png",width,height}){this.buffer=buffer;this.contentType=contentType;this.width=width;this.height=height;Object.freeze(this);} }
module.exports={WelcomeImagePayload};
