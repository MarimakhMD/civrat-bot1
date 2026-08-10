"use strict";
const { WelcomeGoodbyeConfigKey: Key } = require("./welcomeGoodbyeConstants");
const WelcomeGoodbyeConfigSchema = Object.freeze({
  [Key.WELCOME_ENABLED]: { type: "boolean" }, [Key.GOODBYE_ENABLED]: { type: "boolean" },
  [Key.WELCOME_CHANNEL]: { type: "discord-channel", nullable: true }, [Key.GOODBYE_CHANNEL]: { type: "discord-channel", nullable: true },
  [Key.WELCOME_MESSAGE]: { type: "string", maxLength: 4000 }, [Key.GOODBYE_MESSAGE]: { type: "string", maxLength: 4000 },
  [Key.WELCOME_EMBED]: { type: "boolean" }, [Key.GOODBYE_EMBED]: { type: "boolean" },
  [Key.WELCOME_COLOR]: { type: "hex-color" }, [Key.GOODBYE_COLOR]: { type: "hex-color" },
  [Key.WELCOME_DM]: { type: "boolean" }, [Key.WELCOME_DM_MESSAGE]: { type: "string", nullable: true, maxLength: 4000 },
});
module.exports = { WelcomeGoodbyeConfigSchema };
