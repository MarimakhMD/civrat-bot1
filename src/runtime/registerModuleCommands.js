"use strict";
const { getGuildSettingsRuntime } = require("./getGuildSettingsRuntime");
function getDiscordModuleCommands() { return getGuildSettingsRuntime().getDiscordCommands(); }
module.exports = { getDiscordModuleCommands };
