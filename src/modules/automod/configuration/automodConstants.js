"use strict";

const AutoModConfigKey = Object.freeze({
  ENABLED: "automod_enabled",
  ANTI_SPAM: "automod_anti_spam",
  ANTI_LINKS: "automod_anti_links",
  ANTI_INVITES: "automod_anti_invites",
  ANTI_MENTION_SPAM: "automod_anti_mention_spam",
  MENTION_THRESHOLD: "automod_mention_threshold",
  ANTI_EMOJI_SPAM: "automod_anti_emoji_spam",
  EMOJI_THRESHOLD: "automod_emoji_threshold",
  ANTI_CAPS: "automod_anti_caps",
  CAPS_THRESHOLD: "automod_caps_threshold",
  BAD_WORDS: "automod_bad_words",
  DELETE_MESSAGE: "automod_delete_message",
  PUNISHMENT: "automod_punishment",
  TIMEOUT_MINUTES: "automod_timeout_minutes",
});

const AutoModComponentId = Object.freeze({
  SECTION: "civrat:v1:automod:section",
  TOGGLE: "civrat:v1:automod:enable",
  DELETE_MESSAGE: "civrat:v1:automod:delete",
  THRESHOLDS_OPEN: "civrat:v1:automod:thresholds-open",
  THRESHOLDS_MODAL: "civrat:v1:automod:thresholds",
  BAD_WORDS_OPEN: "civrat:v1:automod:badwords-open",
  BAD_WORDS_MODAL: "civrat:v1:automod:badwords",
  ENFORCE_SELECT: "civrat:v1:automod:enforce",
  TOGGLE_PREFIX: "civrat:v1:automod:rule",
  BACK: "civrat:v1:automod:back",
});

const AutoModPunishment = Object.freeze({
  NONE: "none",
  WARN: "warn",
  TIMEOUT: "timeout",
});

module.exports = { AutoModConfigKey, AutoModComponentId, AutoModPunishment };
