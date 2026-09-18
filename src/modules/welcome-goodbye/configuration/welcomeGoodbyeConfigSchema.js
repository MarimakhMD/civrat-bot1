"use strict";
const { WelcomeGoodbyeConfigKey: Key } = require("./welcomeGoodbyeConstants");
const WelcomeGoodbyeConfigSchema = Object.freeze({
  [Key.WELCOME_ENABLED]: { type: "boolean" }, [Key.GOODBYE_ENABLED]: { type: "boolean" },
  [Key.WELCOME_CHANNEL]: { type: "discord-channel", nullable: true }, [Key.GOODBYE_CHANNEL]: { type: "discord-channel", nullable: true },
  [Key.WELCOME_MESSAGE]: { type: "string", maxLength: 4000 }, [Key.GOODBYE_MESSAGE]: { type: "string", maxLength: 4000 },
  [Key.WELCOME_EMBED]: { type: "boolean" }, [Key.GOODBYE_EMBED]: { type: "boolean" },
  [Key.WELCOME_COLOR]: { type: "hex-color" }, [Key.GOODBYE_COLOR]: { type: "hex-color" },
  [Key.WELCOME_DM]: { type: "boolean" }, [Key.WELCOME_DM_MESSAGE]: { type: "string", nullable: true, maxLength: 4000 },
  [Key.WELCOME_TEMPLATE]: { type: "enum", values: ["template-1", "template-2", "template-3"] },
  // 4E/E2 — boolean strict : la validation refuse toute valeur non booléenne,
  // donc ni "true" (chaîne) ni 1 ne peuvent activer l'image.
  [Key.WELCOME_IMAGE_ENABLED]: { type: "boolean" },
  // Image Welcome personnalisée (Premium) : clé d'objet Supabase Storage,
  // de la forme `{guildId}/welcome.png`. Nullable : `null` signifie « aucune
  // image personnalisée », et la livraison retombe sur le template choisi.
  [Key.WELCOME_IMAGE_KEY]: { type: "welcome-image-key", nullable: true },
});
module.exports = { WelcomeGoodbyeConfigSchema };
