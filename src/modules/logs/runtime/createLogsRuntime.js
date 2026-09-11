"use strict";

const { LogsEventMapper } = require("../services/LogsEventMapper");
const { LogsService } = require("../services/LogsService");
const { LogsDeliveryService } = require("../services/LogsDeliveryService");
const { DiscordLogsTransport } = require("../../../adapters/discord/DiscordLogsTransport");
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

function createLogsRuntime({ guildConfigResolver }) {
  const deps = (guild) => ({
    mapper: new LogsEventMapper(),
    service: new LogsService(),
    delivery: new LogsDeliveryService({ logger, transport: new DiscordLogsTransport({ guild }) }),
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

    handleModerationEvent: async ({ guild, config, action, targetId, reason, moderatorId, target, moderator }) =>
      handleModerationEvent({ guild, config: config || await guildConfigResolver.get(guild.id), action, targetId, reason, moderatorId, target, moderator, ...deps(guild) }),

    handleRoleEvent: async ({ guild, config, action, roleId, memberId, target, who, before, after }) =>
      handleRoleEvent({ guild, config: config || await guildConfigResolver.get(guild.id), action, roleId, memberId, target, who, before, after, ...deps(guild) }),

    handleChannelEvent: async ({ channel, config, action, target, who, before, after }) =>
      handleChannelEvent({ channel, config: config || await guildConfigResolver.get(channel.guild.id), action, target, who, before, after, ...deps(channel.guild) }),

    handleInviteEvent: async ({ guild, config, action, inviteCode, inviter, channel, expiresAt, uses, maxUses }) =>
      handleInviteEvent({ guild, config: config || await guildConfigResolver.get(guild.id), action, inviteCode, inviter, channel, expiresAt, uses, maxUses, ...deps(guild) }),

    handleMessageBulkDeleted: async (messages, config) =>
      handleMessageBulkDeleted({ messages, config, ...deps(messages.first().guild) }),

    handleMemberNicknameChanged: async ({ oldMember, newMember, config }) =>
      handleMemberNicknameChanged({ oldMember, newMember, config, ...deps(newMember.guild) }),

    handleCaptchaEvent: async ({ guild, config, action, memberId, roleId }) =>
      handleCaptchaEvent({ guild, config: config || await guildConfigResolver.get(guild.id), action, memberId, roleId, ...deps(guild) }),

    handleTicketEvent: async ({ guild, config, action, ticketChannelId, userId }) =>
      handleTicketEvent({ guild, config: config || await guildConfigResolver.get(guild.id), action, ticketChannelId, userId, ...deps(guild) }),
  };
}

module.exports = { createLogsRuntime };
