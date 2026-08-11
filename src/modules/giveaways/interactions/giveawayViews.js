"use strict";

const { GiveawayComponentId: Id } = require("../configuration/giveawayConstants");

function giveawayView({ t, config }) {
  const enabled = Boolean(config.giveaway_enabled);
  return {
    title: t("giveaway.title"),
    content: t(enabled ? "giveaway.enabled" : "giveaway.disabled"),
    components: [
      { type: "button", customId: Id.TOGGLE, label: t(enabled ? "giveaway.disable" : "giveaway.enable"), style: enabled ? "success" : "secondary" },
      { type: "channel-select", customId: Id.CHANNEL, placeholder: t("giveaway.channel"), channelTypes: [0] },
      { type: "button", customId: Id.BACK, label: t("giveaway.back"), style: "secondary" },
    ],
  };
}

module.exports = { giveawayView };
