"use strict";

const { TempVoiceComponentId: Id } = require("../configuration/tempVoiceConstants");

function tempVoiceView({ t, config }) {
  const enabled = Boolean(config.tempvoice_enabled);
  return {
    title: t("tempvoice.title"),
    content: t(enabled ? "tempvoice.enabled" : "tempvoice.disabled"),
    components: [
      { type: "button", customId: Id.TOGGLE, label: t(enabled ? "tempvoice.disable" : "tempvoice.enable"), style: enabled ? "success" : "secondary" },
      { type: "channel-select", customId: Id.LOBBY_CHANNEL, placeholder: t("tempvoice.lobbyChannel"), channelTypes: [2] },
      { type: "channel-select", customId: Id.CATEGORY_CHANNEL, placeholder: t("tempvoice.categoryChannel"), channelTypes: [4] },
      { type: "button", customId: Id.BACK, label: t("tempvoice.back"), style: "secondary" },
    ],
  };
}

module.exports = { tempVoiceView };
