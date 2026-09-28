"use strict";

const { SecurityComponentId: Id, SecurityConfigKey: Key, SecurityWhitelist, parseWhitelistInput } = require("../configuration/securityConstants");
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

async function openWhitelist({ t, service, guildId, envelope }) {
  const config = await service.read(guildId);
  const whitelist = Array.isArray(config[Key.WHITELIST]) ? config[Key.WHITELIST].join(", ") : "";
  // P9 — le routeur expose transport sur l'enveloppe, pas au premier niveau
  // du contexte (pattern AutoMod/AdminPanel) : lire `envelope.transport`.
  return envelope.transport.showModal({
    customId: Id.WHITELIST_MODAL,
    title: t("security.whitelistModalTitle"),
    fields: [{
      id: "whitelist",
      label: t("security.fieldWhitelist"),
      value: whitelist,
      required: false,
      maxLength: SecurityWhitelist.MODAL_MAX_LENGTH,
    }],
  });
}

async function submitWhitelist({ service, guildId, userId, t, envelope, rateLimitGuard }) {
  if (!(await enforceConfigWrite({ guildId, userId, t, envelope, rateLimitGuard }))) return null;
  // P9 — modalValues vit sur l'enveloppe (pattern AutoMod) : sans cela la
  // soumission arrivait avec undefined et écrasait la liste par [].
  const modalValues = envelope && envelope.modalValues;
  const raw = (modalValues && modalValues.whitelist) || "";
  // P9 — validation stricte : trim, snowflakes ^\d{15,22}$ uniquement,
  // suppression silencieuse des entrées invalides, dédup (ordre conservé),
  // plafond MAX_ENTRIES. Jamais de conversion en nombre JS, aucun throw.
  const whitelist = parseWhitelistInput(raw);
  return service.update(guildId, { [Key.WHITELIST]: whitelist });
}

module.exports = { toggleSecurity, toggleRule, openWhitelist, submitWhitelist, securityView };
