"use strict";

const { LogsEventMapper } = require("../services/LogsEventMapper");
const { LogsService } = require("../services/LogsService");
const { LogsDeliveryService } = require("../services/LogsDeliveryService");
const { DiscordLogsTransport, unrecognizedDetailKeys } = require("../../../adapters/discord/DiscordLogsTransport");
const { handleMessageDeleted } = require("../events/handleMessageDeleted");
const { handleMemberJoined } = require("../events/handleMemberJoined");
const { handleCaptchaEvent } = require("../events/handleCaptchaEvent");
const { handleMessageBulkDeleted } = require("../events/handleMessageBulkDeleted");
const { handleMemberNicknameChanged } = require("../events/handleMemberNicknameChanged");
const { handleInviteEvent } = require("../events/handleInviteEvent");
const { handleChannelEvent } = require("../events/handleChannelEvent");
const { handleRoleEvent } = require("../events/handleRoleEvent");
const { handleModerationEvent } = require("../events/handleModerationEvent");
const { handleMemberLeft } = require("../events/handleMemberLeft");
const { handleMessageUpdated } = require("../events/handleMessageUpdated");
const { handleTicketEvent } = require("../events/handleTicketEvent");

const logger = require("../../../utils/logger");

/**
 * PHASE 1 — résout une guilde réellement utilisable.
 *
 * Plusieurs appelants métier passaient `{ id: guildId }` (un objet sans
 * `channels.cache`) : le transport levait alors un TypeError, ravalé en
 * « LOG_TRANSPORT_FAILED », et le log n'était JAMAIS livré sans aucune cause
 * lisible. On tente d'abord le cache du client ; à défaut, `null`, et la
 * livraison est écartée pour un motif explicite.
 */
function resolveUsableGuild(guild) {
  if (!guild || !guild.id) return null;
  if (guild.channels && guild.channels.cache) return guild;

  const client = guild.client;
  const fromCache = client && client.guilds && client.guilds.cache && client.guilds.cache.get(guild.id);
  if (fromCache && fromCache.channels && fromCache.channels.cache) return fromCache;

  return null;
}

function createLogsRuntime({ guildConfigResolver }) {
  const deps = (guild) => ({
    mapper: new LogsEventMapper(),
    service: new LogsService(),
    delivery: new LogsDeliveryService({
      logger,
      transport: new DiscordLogsTransport({ guild: resolveUsableGuild(guild) }),
      detailInspector: unrecognizedDetailKeys,
    }),
  });

  return {
    handleMessageDeleted: async (message) =>
      handleMessageDeleted({ message, config: await guildConfigResolver.get(message.guild.id), ...deps(message.guild) }),

    handleMessageUpdated: async (message, oldMessage) =>
      handleMessageUpdated({ message, oldMessage, config: await guildConfigResolver.get(message.guild.id), ...deps(message.guild) }),

    handleMemberJoined: async (member, inviteResult, inviterStats) =>
      handleMemberJoined({ member, inviteResult, inviterStats, config: await guildConfigResolver.get(member.guild.id), ...deps(member.guild) }),

    handleMemberLeft: async (member) =>
      handleMemberLeft({ member, config: await guildConfigResolver.get(member.guild.id), ...deps(member.guild) }),

    // PHASE 1 — `rule` et `rules` étaient perdus ici : la déstructuration ne les
    // listait pas, donc AutoMod et Security voyaient leur règle silencieusement
    // disparaître du log.
    handleModerationEvent: async ({ guild, config, action, targetId, reason, rule, rules, moderatorId, target, moderator, duration, avatarUrl }) =>
      handleModerationEvent({ guild, config: config || await guildConfigResolver.get(guild.id), action, targetId, reason, rule, rules, moderatorId, target, moderator, duration, avatarUrl, ...deps(guild) }),

    handleRoleEvent: async ({ guild, config, action, roleId, memberId, target, member, who, before, after, permissions, avatarUrl }) =>
      handleRoleEvent({ guild, config: config || await guildConfigResolver.get(guild.id), action, roleId, memberId, target, member, who, before, after, permissions, avatarUrl, ...deps(guild) }),

    handleChannelEvent: async ({ channel, config, action, target, who, before, after, permissions, parent }) =>
      handleChannelEvent({ channel, config: config || await guildConfigResolver.get(channel.guild.id), action, target, who, before, after, permissions, parent, ...deps(channel.guild) }),

    handleInviteEvent: async ({ guild, config, action, inviteCode, inviter, channel, expiresAt, uses, maxUses, member, avatarUrl }) =>
      handleInviteEvent({ guild, config: config || await guildConfigResolver.get(guild.id), action, inviteCode, inviter, channel, expiresAt, uses, maxUses, member, avatarUrl, ...deps(guild) }),

    handleMessageBulkDeleted: async (messages, config) =>
      handleMessageBulkDeleted({ messages, config, ...deps(messages.first().guild) }),

    // PHASE 1 (correctif 1) — l'appelant passe des VALEURS d'événement figées
    // (`member`, `before`, `after`, `avatarUrl`, `guild`) et non plus les objets
    // vivants. La forme historique `{ oldMember, newMember }` reste acceptée.
    handleMemberNicknameChanged: async (payload) =>
      handleMemberNicknameChanged({
        ...payload,
        ...deps(payload.guild || (payload.newMember && payload.newMember.guild) || null),
      }),

    handleCaptchaEvent: async ({ guild, config, action, memberId, roleId }) =>
      handleCaptchaEvent({ guild, config: config || await guildConfigResolver.get(guild.id), action, memberId, roleId, ...deps(guild) }),

    handleTicketEvent: async ({ guild, config, action, ticketChannelId, userId, reason }) =>
      handleTicketEvent({ guild, config: config || await guildConfigResolver.get(guild.id), action, ticketChannelId, userId, reason, ...deps(guild) }),
  };
}

module.exports = { createLogsRuntime, resolveUsableGuild };
