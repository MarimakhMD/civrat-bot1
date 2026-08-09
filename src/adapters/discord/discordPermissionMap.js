"use strict";
const { PermissionsBitField } = require("discord.js");
const { PermissionName } = require("../../core/permissions");
const DiscordPermission = Object.freeze({ [PermissionName.ADMINISTRATOR]: PermissionsBitField.Flags.Administrator, [PermissionName.MANAGE_GUILD]: PermissionsBitField.Flags.ManageGuild, [PermissionName.MANAGE_ROLES]: PermissionsBitField.Flags.ManageRoles, [PermissionName.MANAGE_CHANNELS]: PermissionsBitField.Flags.ManageChannels, [PermissionName.MODERATE_MEMBERS]: PermissionsBitField.Flags.ModerateMembers });
module.exports = { DiscordPermission };
