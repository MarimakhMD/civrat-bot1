"use strict";
class WelcomeImageRequest { constructor({guildId,userId,locale,avatarUrl=null,textElements=[],dimensions={width:1200,height:400}}){if(!guildId||!userId)throw new TypeError("Welcome image request requires guildId and userId.");this.guildId=guildId;this.userId=userId;this.locale=locale;this.avatarUrl=avatarUrl;this.textElements=Object.freeze([...textElements]);this.dimensions=Object.freeze({...dimensions});Object.freeze(this);} }
module.exports={WelcomeImageRequest};
