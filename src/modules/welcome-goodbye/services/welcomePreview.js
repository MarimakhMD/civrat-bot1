"use strict";

const { WelcomeDeliveryService } = require("./WelcomeDeliveryService");
const { createWelcomeRenderer } = require("./welcomePayload");
const { adaptGuildMember, resolveDateLocale } = require("../../../adapters/discord/DiscordGuildMemberAdapter");
const {
  resolveWelcomeGoodbyeLanguage,
  resolveWelcomeDmMessage,
  resolveConfiguredMessage,
} = require("../configuration/welcomeGoodbyeDefaults");
const { renderDeliveryPayload } = require("./welcomePayload");
const { WelcomeGoodbyeConfigKey: Key } = require("../configuration/welcomeGoodbyeConstants");

/**
 * PHASE 2 (B5) — APERÇU, TEST ET LIVRAISON : MÊME CONTEXTE, MÊME RENDU.
 *
 * Avant cette correction, six entrées produisaient quatre comportements
 * différents : `testWelcome`, `testWelcomeDm`, `previewWelcomeEmbed` et
 * `previewGoodbyeEmbed` envoyaient le texte BRUT (placeholders non résolus),
 * tandis que `previewGoodbye` et `testGoodbye` rendaient avec un contexte réduit
 * à `{guildId}` — donc avec tous les placeholders vides.
 *
 * L'administrateur validait un aperçu qui ne correspondait à rien de ce qui
 * serait réellement envoyé. Ces fonctions sont désormais le seul point d'entrée
 * des aperçus et des tests : elles passent par `WelcomeDeliveryService` en
 * `dryRun`, c'est-à-dire exactement le code de la livraison, arrêté avant
 * l'envoi. La carte Premium n'est jamais générée ici (le `dryRun` intervient
 * avant la logique d'image) : WELCOME_IMAGE reste inchangé.
 */

/** Service de rendu pour les aperçus : mêmes providers que la livraison. */
function createPreviewDeliveryService({ logService = null } = {}) {
  return new WelcomeDeliveryService({ renderer: createWelcomeRenderer(), logService });
}

/**
 * Contexte membre d'un aperçu : celui de l'administrateur qui clique.
 *
 * C'est un vrai `GuildMember`, adapté par le MÊME adaptateur que la livraison :
 * les placeholders résolvent donc aux mêmes valeurs (mêmes dates localisées,
 * même `{membercount}`). Sans membre (appel hors guilde, test unitaire), un
 * contexte minimal explicite est produit — jamais de valeur inventée.
 */
function buildPreviewContext(context) {
  const language = resolveWelcomeGoodbyeLanguage(context && context.config);
  if (context && context.member && context.member.guild) {
    return adaptGuildMember(context.member, { language });
  }
  return {
    guildId: (context && context.guildId) || null,
    userId: (context && context.userId) || null,
    user: null,
    username: null,
    displayName: null,
    isBot: false,
    avatarUrl: null,
    server: null,
    memberCount: null,
    joinDate: null,
    accountAge: null,
    date: null,
    time: null,
  };
}

/** Payload Welcome identique à celui de la livraison, sans envoi. */
async function previewWelcomePayload(context) {
  const delivery = createPreviewDeliveryService();
  return delivery.welcome(buildPreviewContext(context), context.config, null, { dryRun: true });
}

/** Payload Goodbye identique à celui de la livraison, sans envoi. */
async function previewGoodbyePayload(context) {
  const delivery = createPreviewDeliveryService();
  return delivery.goodbye(buildPreviewContext(context), context.config, null, { dryRun: true });
}

/** Contenu Welcome rendu (texte seul) — utilisé par le test en salon et le DM. */
async function previewWelcomeContent(context) {
  const payload = await previewWelcomePayload(context);
  return payload ? payload.content : "";
}

/** Contenu Goodbye rendu (texte seul). */
async function previewGoodbyeContent(context) {
  const payload = await previewGoodbyePayload(context);
  return payload ? payload.content : "";
}

/**
 * Contenu du DM Welcome rendu, avec la MÊME chaîne de repli que la livraison :
 * message DM configuré, sinon message Welcome configuré, sinon défaut localisé.
 */
function previewWelcomeDmContent(context) {
  const message = resolveWelcomeDmMessage((context && context.config) || {});
  return createWelcomeRenderer().render(message, buildPreviewContext(context));
}

/**
 * Aperçu de l'EMBED seul.
 *
 * Indépendant du toggle d'activation (l'administrateur règle l'apparence avant
 * d'activer), mais produit par le même chemin de rendu : le texte est résolu, et
 * un message absent retombe sur le défaut dans la langue de la guilde.
 */
function previewWelcomeEmbedPayload(context) {
  const config = (context && context.config) || {};
  return renderDeliveryPayload({
    message: resolveConfiguredMessage(config, Key.WELCOME_MESSAGE, "welcome"),
    context: buildPreviewContext(context),
    embedEnabled: true,
    color: config[Key.WELCOME_COLOR],
  });
}

function previewGoodbyeEmbedPayload(context) {
  const config = (context && context.config) || {};
  return renderDeliveryPayload({
    message: resolveConfiguredMessage(config, Key.GOODBYE_MESSAGE, "goodbye"),
    context: buildPreviewContext(context),
    embedEnabled: true,
    color: config[Key.GOODBYE_COLOR],
  });
}

module.exports = {
  createPreviewDeliveryService,
  previewWelcomeDmContent,
  previewWelcomeEmbedPayload,
  previewGoodbyeEmbedPayload,
  buildPreviewContext,
  previewWelcomePayload,
  previewGoodbyePayload,
  previewWelcomeContent,
  previewGoodbyeContent,
  resolveDateLocale,
};
