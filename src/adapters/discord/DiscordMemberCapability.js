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
    hasInChannel: (permission, channel) => {
      if (!member?.guild?.id || (channel?.guildId || channel?.guild?.id) !== member.guild.id) return false;
      const flag = Object.hasOwn(DiscordPermission, permission) ? DiscordPermission[permission] : null;
      if (flag === null || flag === undefined) return false;
      try { return Boolean(channel.permissionsFor?.(member)?.has(flag)); }
      catch { return false; }
    },
    hasRole: (roleId) => Boolean(roleId && member?.roles?.cache?.has?.(roleId)),
  });
}

module.exports = { createDiscordMemberCapability };
