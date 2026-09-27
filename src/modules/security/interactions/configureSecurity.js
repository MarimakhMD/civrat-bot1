"use strict";

const { SecurityComponentId: Id, SecurityConfigKey: Key } = require("../configuration/securityConstants");
const { securityView } = require("./securityViews");
const { enforceConfigWrite } = require("../../../core/rateLimit/ActionRateLimitGuard");

// P6 §5 — les ÉCRITURES passent par enforceConfigWrite AVANT le read et
// l'upsert (30 / 60 s par guild+user) ; au dépassement la réponse éphémère
// est déjà envoyée et la fonction retourne null (pas de vue rafraîchie).
// Les LECTURES (openWhitelist, render) ne sont jamais limitées.
async function toggleSecurity({ service, guildId, userId, t, envelope, rateLimitGuard }) {
  if (!(await enforceConfigWrite({ guildId, userId, t, envelope, rateLimitGuard }))) return null;
  const config = await service.read(guildId);
  return service.update(guildId, { [Key.ENABLED]: !config[Key.ENABLED] });
}

async function toggleRule({ service, guildId, userId, t, envelope, rateLimitGuard, key }) {
  if (!(await enforceConfigWrite({ guildId, userId, t, envelope, rateLimitGuard }))) return null;
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

async function submitWhitelist({ service, guildId, userId, t, envelope, rateLimitGuard, modalValues }) {
  if (!(await enforceConfigWrite({ guildId, userId, t, envelope, rateLimitGuard }))) return null;
  const raw = (modalValues && modalValues.whitelist) || "";
  const whitelist = raw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  return service.update(guildId, { [Key.WHITELIST]: whitelist });
}

module.exports = { toggleSecurity, toggleRule, openWhitelist, submitWhitelist, securityView };
