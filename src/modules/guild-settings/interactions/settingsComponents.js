"use strict";

const SettingsComponentId = Object.freeze({
  LANGUAGE: "civrat:v1:guild-settings:language",
  CATEGORY: "civrat:v1:guild-settings:category",
  HOME: "civrat:v1:guild-settings:home",
});

const SettingsAction = Object.freeze({
  OPEN_LANGUAGE: "open-language",
  OPEN_CATEGORY: "open-category",
  OPEN_HOME: "open-home",
});

module.exports = { SettingsComponentId, SettingsAction };
