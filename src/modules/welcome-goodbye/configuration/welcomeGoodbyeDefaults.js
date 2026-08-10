"use strict";
const { WelcomeGoodbyeConfigKey: Key } = require("./welcomeGoodbyeConstants");
const WelcomeGoodbyeDefaults = Object.freeze({ [Key.WELCOME_ENABLED]: false, [Key.GOODBYE_ENABLED]: false, [Key.WELCOME_CHANNEL]: null, [Key.GOODBYE_CHANNEL]: null, [Key.WELCOME_MESSAGE]: "Welcome {mention} to {server}!", [Key.GOODBYE_MESSAGE]: "Goodbye {username}!", [Key.WELCOME_EMBED]: false, [Key.GOODBYE_EMBED]: false, [Key.WELCOME_COLOR]: "#00e85c", [Key.GOODBYE_COLOR]: "#ff4444", [Key.WELCOME_DM]: false, [Key.WELCOME_DM_MESSAGE]: null });
module.exports = { WelcomeGoodbyeDefaults };
