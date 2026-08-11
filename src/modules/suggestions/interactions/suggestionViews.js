"use strict";

const { SuggestionComponentId: Id } = require("../configuration/suggestionConstants");

function suggestionView({ t, config }) {
  const enabled = Boolean(config.suggestion_enabled);
  return {
    title: t("suggestion.title"),
    content: t(enabled ? "suggestion.enabled" : "suggestion.disabled"),
    components: [
      { type: "button", customId: Id.TOGGLE, label: t(enabled ? "suggestion.disable" : "suggestion.enable"), style: enabled ? "success" : "secondary" },
      { type: "channel-select", customId: Id.CHANNEL, placeholder: t("suggestion.channel"), channelTypes: [0] },
      { type: "button", customId: Id.BACK, label: t("suggestion.back"), style: "secondary" },
    ],
  };
}

module.exports = { suggestionView };
