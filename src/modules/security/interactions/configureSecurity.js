"use strict";

const { SecurityComponentId: Id, SecurityConfigKey: Key } = require("../configuration/securityConstants");
const { securityView } = require("./securityViews");

async function toggleSecurity({ service, guildId }) {
  const config = await service.read(guildId);
  return service.update(guildId, { [Key.ENABLED]: !config[Key.ENABLED] });
}

async function toggleRule({ service, guildId, key }) {
  const config = await service.read(guildId);
  return service.update(guildId, { [key]: !config[key] });
}

async function openWhitelist({ t, service, guildId, transport }) {
  const config = await service.read(guildId);
  const whitelist = Array.isArray(config.security_whitelist) ? config.security_whitelist.join(", ") : "";
  return transport.showModal({
    customId: Id.WHITELIST_MODAL,
    title: t("security.whitelistModalTitle"),
    fields: [{ id: "whitelist", label: t("security.fieldWhitelist"), value: whitelist, required: false }],
  });
}

async function submitWhitelist({ service, guildId, modalValues }) {
  const raw = (modalValues && modalValues.whitelist) || "";
  const whitelist = raw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  return service.update(guildId, { [Key.WHITELIST]: whitelist });
}

module.exports = { toggleSecurity, toggleRule, openWhitelist, submitWhitelist, securityView };
