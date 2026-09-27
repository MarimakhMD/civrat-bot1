"use strict";

const { AutoModDetectionService } = require("../services/AutoModDetectionService");
const { AutoModEnforcementService } = require("../services/AutoModEnforcementService");
const { DiscordAutoModTransport } = require("../../../adapters/discord/DiscordAutoModTransport");

function countMentions(message) {
  if (!message || !message.mentions) return 0;
  if (typeof message.mentions.size === "number") return message.mentions.size;
  return message.mentions.users ? message.mentions.users.size : message.mentions.members ? message.mentions.members.size : 0;
}

function safeHas(permissions, name) {
  try {
    return Boolean(permissions.has(name));
  } catch {
    return false;
  }
}

/**
 * P7 — exemption rôle OU salon, évaluée UNE seule fois dans `process()`
 * (choke point commun à messageCreate et messageUpdate).
 *
 * Sémantique : `roleExempt || channelExempt`.
 *  - rôle : `member.roles.cache.has(id)` — O(1), aucun fetch ; un rôle
 *    supprimé/dangling renvoie false et n'exempte plus personne ;
 *  - salon : comparaison avec `message.channelId` — O(1), aucun fetch, aucune
 *    DB. Pas de logique parentId : un thread n'est PAS exempté via son parent.
 *
 * Les listes sont bornées à 10 entrées à l'écriture (validation P7) et
 * normalisées en tableaux par AutoModConfigService.read(), donc ces some()
 * sont O(10) au pire — aucun Set reconstruit, aucune règle ne re-passe par ici.
 */
function isExemptFromAutoMod({ config, member, channelId, guildId }) {
  const exemptRoles = Array.isArray(config.automod_exempt_roles) ? config.automod_exempt_roles : [];
  const exemptChannels = Array.isArray(config.automod_exempt_channels) ? config.automod_exempt_channels : [];
  if (exemptRoles.length === 0 && exemptChannels.length === 0) return false;

  const roleCache = member && member.roles && member.roles.cache;
  const roleExempt = exemptRoles.length > 0
    && Boolean(roleCache && typeof roleCache.has === "function")
    // `@everyone` a pour ID l'ID de la guilde : même si une valeur brute
    // contournait la validation à l'écriture, elle ne doit jamais exempter.
    && exemptRoles.some((roleId) => roleId !== guildId && roleCache.has(roleId));

  const channelExempt = exemptChannels.length > 0
    && typeof channelId === "string"
    && exemptChannels.includes(channelId);

  return roleExempt || channelExempt;
}

/**
 * Builds the AutoMod runtime. The runtime reads guild configuration, runs the
 * transport-neutral detection service, and applies the configured enforcement
 * through an injected enforcer factory.
 */
function createAutoModRuntime({ guildConfigResolver, configService, detection, enforcementService, enforcerFactory, logsRuntimeFactory }) {
  const resolver = configService || (guildConfigResolver ? { read: (guildId) => guildConfigResolver.get(guildId) } : null);
  if (!resolver || typeof resolver.read !== "function") {
    throw new TypeError("createAutoModRuntime requires guildConfigResolver or configService.");
  }

  const detector = detection || new AutoModDetectionService();
  const enforcer = enforcementService || new AutoModEnforcementService();
  const makeEnforcer = enforcerFactory || ((message) => new DiscordAutoModTransport({ guild: message.guild }));
  const logFactory = typeof logsRuntimeFactory === "function" ? logsRuntimeFactory : () => null;

  // Cœur commun à la création et à l'édition : lit la config, détecte, applique.
  // `messageId` alimente la dé-duplication du compteur de spam (une édition ne
  // doit pas compter comme un message supplémentaire).
  async function process(message, messageId) {
    const config = await resolver.read(message.guild.id);
    if (!config || !config.automod_enabled) return { matched: false, code: "AUTOMOD_DISABLED" };
    if (message.author && message.author.bot) return { matched: false, code: "AUTOMOD_IGNORED" };

    const member = message.member;
    const authorPermissions = member && member.permissions
      ? { administrator: safeHas(member.permissions, "Administrator"), manageMessages: safeHas(member.permissions, "ManageMessages") }
      : null;

    // P7 — exemption rôle OU salon : évaluée ICI, dans le point commun
    // messageCreate/messageUpdate, APRÈS config/bot/admin et AVANT detect()
    // (donc avant le compteur de spam). Aucun fetch Discord, aucune DB :
    // roles.cache.has() + comparaison channelId, listes bornées à 10.
    const exempt = isExemptFromAutoMod({
      config,
      member,
      channelId: typeof message.channelId === "string"
        ? message.channelId
        : (message.channel && message.channel.id) || null,
      guildId: message.guild.id,
    });

    const result = detector.detect({
      config,
      authorIsBot: Boolean(message.author && message.author.bot),
      authorPermissions,
      exempt,
      guildId: message.guild.id,
      authorId: message.author && message.author.id,
      content: message.content || "",
      mentionCount: countMentions(message),
      messageId,
    });

    // Un message exempté ressort en AUTOMOD_IGNORED (contrat P7 §10) ; les
    // autres cas non-appariés gardent le code historique AUTOMOD_NO_MATCH.
    if (!result.matched) {
      return { matched: false, code: exempt ? "AUTOMOD_IGNORED" : "AUTOMOD_NO_MATCH" };
    }

    const actions = await enforcer.enforce({
      message,
      detection: result,
      config,
      enforcer: makeEnforcer(message),
      logsRuntimeFactory: logFactory,
    });

    return { matched: true, code: result.code, rules: result.rules, actions };
  }

  return {
    handleMessage: async (message) => {
      if (!message || !message.guild) return { matched: false, code: "AUTOMOD_IGNORED" };
      return process(message, message.id);
    },

    // PHASE 3.1 (P1) — AutoMod sur les ÉDITIONS de message.
    //
    // Garde anti-double-traitement : un `messageUpdate` sans changement de
    // contenu (embed ajouté, pin, réaction, retransmission...) ne doit PAS
    // re-déclencher la détection, sinon chaque mise à jour secondaire
    // produirait une sanction et un log supplémentaires pour un contenu qui
    // n'a pas changé. On ne traite que les éditions dont le contenu diffère
    // réellement ; la dé-duplication du compteur de spam est assurée côté
    // détection par le `messageId`.
    handleMessageEdited: async (oldMessage, newMessage) => {
      if (!newMessage || !newMessage.guild) return { matched: false, code: "AUTOMOD_IGNORED" };
      if (newMessage.author && newMessage.author.bot) return { matched: false, code: "AUTOMOD_IGNORED" };
      // On ne peut comparer fiablement l'ancien et le nouveau contenu que si les
      // DEUX messages sont complets (non partiels). Dès qu'un des deux est
      // partiel, il est impossible de prouver que le contenu a changé : on
      // s'abstient alors de toute exécution/sanction afin de ne JAMAIS
      // re-sanctionner un contenu inchangé (update secondaire, restart, message
      // non caché). Les éditions réelles sur messages en cache (cas nominal,
      // les deux complets) restent détectées et sanctionnées.
      if (!oldMessage || oldMessage.partial || newMessage.partial) {
        return { matched: false, code: "AUTOMOD_IGNORED" };
      }
      if (oldMessage.content === newMessage.content) {
        return { matched: false, code: "AUTOMOD_IGNORED" };
      }
      return process(newMessage, newMessage.id);
    },
  };
}

module.exports = { createAutoModRuntime, countMentions, isExemptFromAutoMod };
