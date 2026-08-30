"use strict";

const { PermissionName } = require("../../core/permissions");
const { DiscordPermission } = require("./discordPermissionMap");

function createDiscordMemberCapability(member, guildOwnerId) {
  const isGuildOwner = Boolean(member && guildOwnerId && member.id === guildOwnerId);
  return Object.freeze({
    isGuildOwner,
    has: (permission) => permission === PermissionName.GUILD_OWNER
      ? isGuildOwner
      : Boolean(member?.permissions?.has(DiscordPermission[permission])),
    hasRole: (roleId) => Boolean(roleId && member?.roles?.cache?.has?.(roleId)),
  });
}

module.exports = { createDiscordMemberCapability };
