"use strict";

const InviteConfigKey = Object.freeze({
  ENABLED: "invitations_enabled",
  LOG_CHANNEL_ID: "invitations_log_channel_id",
});

const INVITE_DEFAULTS = Object.freeze({
  invitations_enabled: false,
  invitations_log_channel_id: null,
});

module.exports = { InviteConfigKey, INVITE_DEFAULTS };
