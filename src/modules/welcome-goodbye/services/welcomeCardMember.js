"use strict";

const { WelcomeGoodbyeConfigKey: Key } = require("../configuration/welcomeGoodbyeConstants");
const { WelcomeTemplateRenderer, defaultPlaceholderProviders } = require("./WelcomeTemplateRenderer");

/**
 * Construction du membre et du sous-titre de la carte Welcome.
 *
 * Extrait du handler d'aperçu pour être partagé avec le téléversement d'image :
 * l'administrateur doit voir, après upload, EXACTEMENT la carte qui sera
 * envoyée. Auparavant cette construction n'existait qu'à un seul endroit, ce
 * qui rendait impossible de garantir cette égalité.
 *
 * Note — divergence préexistante, volontairement conservée : `joinDate` utilise
 * ici `toLocaleDateString()` brut, alors que la livraison réelle passe par
 * `adaptGuildMember` (dates localisées selon la langue de la guilde). Ce n'est
 * pas introduit par l'image personnalisée et cela ne concerne que la date
 * affichée dans le sous-titre, pas l'image de fond.
 */
function buildWelcomeCardMember(discordMember) {
  const username = discordMember?.user?.username || "user";
  return {
    guildId: null,
    userId: null,
    user: `@${username}`,
    mention: `@${username}`,
    username,
    displayName: discordMember?.displayName || username || "CIVRAT",
    avatarUrl: discordMember?.user?.displayAvatarURL?.({ extension: "png", size: 256 }) || null,
    server: discordMember?.guild?.name || "CIVRAT",
    memberCount: discordMember?.guild?.memberCount,
    joinDate: discordMember?.joinedAt?.toLocaleDateString?.(),
  };
}

/** Sous-titre : le message Welcome configuré, placeholders résolus. */
function buildWelcomeCardSubtitle(config, member) {
  return new WelcomeTemplateRenderer({ providers: defaultPlaceholderProviders() })
    .render(config?.[Key.WELCOME_MESSAGE] || "", member);
}

module.exports = { buildWelcomeCardMember, buildWelcomeCardSubtitle };
