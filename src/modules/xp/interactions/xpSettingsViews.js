"use strict";

const { XPComponentId: Id } = require("../configuration/xpConstants");

// Phase 11 — sous-vue /settings « XP » : toggle d'activation + salon restreint
// optionnel (xp_channel_id, déjà appliqué par le runtime XP) + retour. Le taux
// (xp_rate) n'est pas éditable en V1 : défaut documenté dans la phase.
function xpSettingsView({ t, config }) {
  const enabled = Boolean(config.xp_enabled);
  const channelLine = config.xp_channel_id ? `<#${config.xp_channel_id}>` : t("xp.channelAll");
  return {
    title: t("xp.settingsTitle"),
    content: [t(enabled ? "xp.enabled" : "xp.disabled"), t("xp.channelLine", { channel: channelLine })].join("\n"),
    components: [
      { type: "button", customId: Id.TOGGLE, label: t(enabled ? "xp.disable" : "xp.enable"), style: enabled ? "success" : "secondary" },
      { type: "channel-select", customId: Id.CHANNEL, placeholder: t("xp.channel"), channelTypes: [0] },
      { type: "button", customId: Id.BACK, label: t("xp.back"), style: "secondary" },
    ],
  };
}

module.exports = { xpSettingsView };
