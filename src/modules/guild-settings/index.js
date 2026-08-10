"use strict";
module.exports = { ...require("./register"), ...require("./services/GuildSettingsService"), ...require("./commands/settingsCommand"), ...require("./interactions/settingsComponents") };
