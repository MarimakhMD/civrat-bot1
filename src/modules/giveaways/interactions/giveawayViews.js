"use strict";

const { GiveawayComponentId: Id } = require("../configuration/giveawayConstants");

function giveawayView({ t, config }) {
  // C1 : nom réel de la colonne guild_configs.
  const enabled = Boolean(config.giveaways_enabled);
  return {
    title: t("giveaway.title"),
    content: t(enabled ? "giveaway.enabled" : "giveaway.disabled"),
    components: [
      { type: "button", customId: Id.TOGGLE, label: t(enabled ? "giveaway.disable" : "giveaway.enable"), style: enabled ? "success" : "secondary" },
      // C1 : le sélecteur de salon a été retiré. Il persistait vers
      // giveaway_channel_id, colonne inexistante : la sélection échouait en
      // silence et le salon n'était jamais résolu. Le giveaway est publié dans
      // le salon où /giveaway create est exécuté.
      { type: "button", customId: Id.BACK, label: t("giveaway.back"), style: "secondary" },
    ],
  };
}

module.exports = { giveawayView };
