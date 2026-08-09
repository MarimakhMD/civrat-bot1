"use strict";
const { WelcomeGoodbyeConfigKey: Key } = require("../configuration/welcomeGoodbyeConstants");
function welcomeUpdatedMessage(t, config) { return t(config[Key.WELCOME_ENABLED] ? "welcomeGoodbye.welcomeEnabled" : "welcomeGoodbye.welcomeDisabled"); }
function goodbyeUpdatedMessage(t, config) { return t(config.goodbye_enabled ? "welcomeGoodbye.goodbyeEnabled" : "welcomeGoodbye.goodbyeDisabled"); }
module.exports = { welcomeUpdatedMessage, goodbyeUpdatedMessage };
