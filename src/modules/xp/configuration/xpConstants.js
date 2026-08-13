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

// Phase 11 : identifiants des composants /settings XP.
const XPComponentId = Object.freeze({
  SECTION: "civrat:v1:xp:section",
  TOGGLE: "civrat:v1:xp:toggle",
  CHANNEL: "civrat:v1:xp:channel",
  BACK: "civrat:v1:xp:back",
});

module.exports = { XPConfigKey, XPComponentId, XP_DEFAULTS, XP_GAIN };
