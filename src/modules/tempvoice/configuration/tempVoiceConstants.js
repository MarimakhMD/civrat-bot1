"use strict";

const TempVoiceConfigKey = Object.freeze({
  ENABLED: "tempvoice_enabled",
  LOBBY_CHANNEL_ID: "tempvoice_lobby_channel_id",
  CATEGORY_ID: "tempvoice_category_id",
});

const TempVoiceComponentId = Object.freeze({
  SECTION: "civrat:v1:tempvoice:section",
  TOGGLE: "civrat:v1:tempvoice:toggle",
  LOBBY_CHANNEL: "civrat:v1:tempvoice:lobby",
  CATEGORY_CHANNEL: "civrat:v1:tempvoice:category",
  BACK: "civrat:v1:tempvoice:back",
});

const TEMPVOICE_DEFAULTS = Object.freeze({
  tempvoice_enabled: false,
  tempvoice_lobby_channel_id: null,
  tempvoice_category_id: null,
});

module.exports = { TempVoiceConfigKey, TempVoiceComponentId, TEMPVOICE_DEFAULTS };
