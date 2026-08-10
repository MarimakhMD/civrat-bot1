"use strict";

const SecurityConfigKey = Object.freeze({
  ENABLED: "security_enabled",
  ANTI_RAID: "security_anti_raid",
  ANTI_BOT: "security_anti_bot",
  WHITELIST: "security_whitelist",
  ANTI_NUKE: "security_anti_nuke",
  LOG_CHANNEL_ID: "security_log_channel_id",
});

const SECURITY_DEFAULTS = Object.freeze({
  security_enabled: false,
  security_anti_raid: false,
  security_anti_bot: false,
  security_whitelist: [],
  security_anti_nuke: false,
  security_log_channel_id: null,
});

const SecurityRaidDefaults = Object.freeze({
  WINDOW_MS: 15000,
  THRESHOLD: 5,
});

const SecurityNukeDefaults = Object.freeze({
  WINDOW_MS: 15000,
  THRESHOLDS: Object.freeze({
    channelCreate: 10,
    channelDelete: 12,
    roleCreate: 30,
    roleDelete: 32,
  }),
});

module.exports = { SecurityConfigKey, SECURITY_DEFAULTS, SecurityRaidDefaults, SecurityNukeDefaults };
