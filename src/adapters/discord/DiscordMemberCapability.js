"use strict";
const { PermissionName } = require("../../core/permissions");
const { DiscordPermission } = require("./discordPermissionMap");
function createDiscordMemberCapability(member, guildOwnerId) { return Object.freeze({ isGuildOwner: Boolean(member && guildOwnerId && member.id === guildOwnerId), has: (permission) => permission === PermissionName.GUILD_OWNER ? Boolean(member && guildOwnerId && member.id === guildOwnerId) : Boolean(member?.permissions?.has(DiscordPermission[permission])) }); }
module.exports = { createDiscordMemberCapability };
