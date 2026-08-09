"use strict";
const legacyConfigService = require("../services/guildConfig");
const logger = require("../utils/logger");
const { createGuildSettingsRuntime } = require("./createGuildSettingsRuntime");
let runtime;
function getGuildSettingsRuntime() { runtime ||= createGuildSettingsRuntime({ legacyConfigService, logger }); return runtime; }
module.exports = { getGuildSettingsRuntime };
