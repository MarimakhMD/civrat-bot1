"use strict";
const { PlaceholderName } = require("../configuration/welcomeGoodbyeConstants");
class WelcomeTemplateRenderer { constructor({providers=[]}={}){this.providers=new Map();providers.forEach(provider=>this.register(provider));} register(provider){if(!provider?.name||typeof provider.resolve!=="function")throw new TypeError("Invalid placeholder provider");if(this.providers.has(provider.name))throw new Error(`Duplicate placeholder: ${provider.name}`);this.providers.set(provider.name,provider);} render(template,context){return String(template||"").replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g,(token,name)=>this.providers.has(name)?String(this.providers.get(name).resolve(context)):token);} }
function defaultPlaceholderProviders(){return [
{name:PlaceholderName.USER,resolve:c=>c.user||c.mention||""},
{name:PlaceholderName.MENTION,resolve:c=>c.mention||c.user||""},
{name:PlaceholderName.USERNAME,resolve:c=>c.username||""},
{name:PlaceholderName.DISPLAY_NAME,resolve:c=>c.displayname||c.displayName||""},
{name:PlaceholderName.USER_ID,resolve:c=>c.userid||c.userId||""},
{name:PlaceholderName.SERVER,resolve:c=>c.server||""},
{name:PlaceholderName.MEMBER_COUNT,resolve:c=>c.membercount||c.memberCount||""},
{name:PlaceholderName.JOIN_DATE,resolve:c=>c.joindate||c.joinDate||""},
];}
module.exports={WelcomeTemplateRenderer,defaultPlaceholderProviders};
