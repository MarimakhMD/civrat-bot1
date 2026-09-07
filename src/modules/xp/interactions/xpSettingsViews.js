"use strict";

const { XPComponentId: Id } = require("../configuration/xpConstants");
const { resolveXpPerMessage, resolveXpCooldownSeconds } = require("../services/XPService");

// A2 — sous-vue /settings « XP » : toggle d'activation + rappel des valeurs
// réellement appliquées + retour.
//
// Le gain et le cooldown sont affichés via les MÊMES fonctions de résolution
// que XPService (resolveXpPerMessage / resolveXpCooldownSeconds) : l'écran ne
// peut donc pas annoncer une valeur différente de celle qui est appliquée.
//
// La restriction à un salon a été supprimée (DCA4) : elle reposait sur la
// colonne inexistante xp_channel_id.
function xpSettingsView({ t, config }) {
  const enabled = Boolean(config && config.xp_enabled);
  const perMessage = resolveXpPerMessage(config);
  const cooldown = resolveXpCooldownSeconds(config);
  return {
    title: t("xp.settingsTitle"),
    content: [
      t(enabled ? "xp.enabled" : "xp.disabled"),
      t("xp.perMessageLine", { amount: perMessage }),
      t("xp.cooldownLine", { seconds: cooldown }),
    ].join("\n"),
    components: [
      { type: "button", customId: Id.TOGGLE, label: t(enabled ? "xp.disable" : "xp.enable"), style: enabled ? "success" : "secondary" },
      { type: "button", customId: Id.BACK, label: t("xp.back"), style: "secondary" },
    ],
  };
}

module.exports = { xpSettingsView };
