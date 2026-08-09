"use strict";
const { SlashCommandBuilder } = require("discord.js");
const { DiscordPermission } = require("./discordPermissionMap");
function toDiscordCommand(definition, execute) { const builder = new SlashCommandBuilder().setName(definition.name).setDescription(definition.description); const permission = definition.permissions?.allOf?.length === 1 ? DiscordPermission[definition.permissions.allOf[0]] : null; if (permission) builder.setDefaultMemberPermissions(permission); return { data: builder, execute }; }
module.exports = { toDiscordCommand };
