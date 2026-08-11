"use strict";

const GiveawayConfigKey = Object.freeze({
  ENABLED: "giveaway_enabled",
  CHANNEL_ID: "giveaway_channel_id",
});

const GiveawayComponentId = Object.freeze({
  SECTION: "civrat:v1:giveaway:section",
  TOGGLE: "civrat:v1:giveaway:toggle",
  CHANNEL: "civrat:v1:giveaway:channel",
  BACK: "civrat:v1:giveaway:back",
  JOIN: "giveaway_join",
});

const GIVEAWAY_DEFAULTS = Object.freeze({
  giveaway_enabled: false,
  giveaway_channel_id: null,
});

module.exports = { GiveawayConfigKey, GiveawayComponentId, GIVEAWAY_DEFAULTS };
