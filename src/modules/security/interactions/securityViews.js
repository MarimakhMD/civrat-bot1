"use strict";

const { SecurityComponentId: Id } = require("../configuration/securityConstants");

function securityView({ t, config }) {
  const enabled = Boolean(config.security_enabled);
  const antiRaid = Boolean(config.security_anti_raid);
  const antiBot = Boolean(config.security_anti_bot);
  const antiNuke = Boolean(config.security_anti_nuke);
  const whitelistCount = Array.isArray(config.security_whitelist) ? config.security_whitelist.length : 0;
  return {
    title: t("security.title"),
    content: t(enabled ? "security.enabled" : "security.disabled"),
    components: [
      { type: "button", customId: Id.TOGGLE, label: t(enabled ? "security.disable" : "security.enable"), style: enabled ? "success" : "secondary" },
      { type: "button", customId: Id.ANTI_RAID, label: `${antiRaid ? "✅ " : "⬜ "}${t("security.antiRaid")}`, style: antiRaid ? "success" : "secondary" },
      { type: "button", customId: Id.ANTI_BOT, label: `${antiBot ? "✅ " : "⬜ "}${t("security.antiBot")}`, style: antiBot ? "success" : "secondary" },
      { type: "button", customId: Id.ANTI_NUKE, label: `${antiNuke ? "✅ " : "⬜ "}${t("security.antiNuke")}`, style: antiNuke ? "success" : "secondary" },
      { type: "button", customId: Id.WHITELIST_OPEN, label: `${t("security.whitelist")} (${whitelistCount})`, style: "primary" },
      { type: "button", customId: Id.BACK, label: t("security.back"), style: "secondary" },
    ],
  };
}

module.exports = { securityView };
