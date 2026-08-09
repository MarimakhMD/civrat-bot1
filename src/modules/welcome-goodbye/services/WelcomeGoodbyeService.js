"use strict";const {WelcomeGoodbyeConfigKey:K}=require("../configuration/welcomeGoodbyeConstants");const { validateWelcomeGoodbyeUpdates } = require("../configuration/welcomeGoodbyeValidation");
class WelcomeGoodbyeService {constructor({guildConfigResolver}){this.config=guildConfigResolver;} async get(guildId){return this.config.get(guildId);} async update(guildId,updates){validateWelcomeGoodbyeUpdates(updates);return this.config.update(guildId,updates);} }
module.exports={WelcomeGoodbyeService};
