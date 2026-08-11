"use strict";

const XPConfigKey = Object.freeze({
  ENABLED: "xp_enabled",
  CHANNEL_ID: "xp_channel_id",
  RATE: "xp_rate",
});

const XP_DEFAULTS = Object.freeze({
  xp_enabled: false,
  xp_channel_id: null,
  xp_rate: 1,
});

const XP_GAIN = Object.freeze({
  MIN: 15,
  MAX: 25,
  COOLDOWN_MS: 60 * 1000,
});

module.exports = { XPConfigKey, XP_DEFAULTS, XP_GAIN };
