"use strict";

const SuggestionConfigKey = Object.freeze({
  ENABLED: "suggestion_enabled",
  CHANNEL_ID: "suggestion_channel_id",
  APPROVAL_REQUIRED: "suggestion_approval_required",
});

const SuggestionComponentId = Object.freeze({
  SECTION: "civrat:v1:suggestion:section",
  TOGGLE: "civrat:v1:suggestion:toggle",
  CHANNEL: "civrat:v1:suggestion:channel",
  APPROVAL: "civrat:v1:suggestion:approval",
  BACK: "civrat:v1:suggestion:back",
  VOTE_UP: "suggestion_up",
  VOTE_DOWN: "suggestion_down",
  APPROVE: "suggestion_approve",
  REJECT: "suggestion_reject",
  DELETE: "suggestion_delete",
});

const SUGGESTION_DEFAULTS = Object.freeze({
  suggestion_enabled: false,
  suggestion_channel_id: null,
  suggestion_approval_required: false,
});

const SuggestionStatus = Object.freeze({
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
  DELETED: "deleted",
});

module.exports = { SuggestionConfigKey, SuggestionComponentId, SUGGESTION_DEFAULTS, SuggestionStatus };
