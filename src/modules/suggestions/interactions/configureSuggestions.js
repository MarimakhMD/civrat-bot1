"use strict";

const { SuggestionComponentId: Id, SuggestionConfigKey: Key } = require("../configuration/suggestionConstants");
const { enforceConfigWrite } = require("../../../core/rateLimit/ActionRateLimitGuard");

// P6 §5 — toute écriture de configuration passe par `enforceConfigWrite`
// AVANT le `read` et l'upsert ; au dépassement (30 / 60 s par guild+user) la
// réponse éphémère est déjà envoyée et la fonction retourne `null`
// (l'appelant ne doit ni écrire ni rafraîchir la vue).
async function toggleSuggestion({ service, guildId, userId, t, envelope, rateLimitGuard }) {
  if (!(await enforceConfigWrite({ guildId, userId, t, envelope, rateLimitGuard }))) return null;
  const config = await service.read(guildId);
  return service.update(guildId, { [Key.ENABLED]: !config[Key.ENABLED] });
}

async function selectSuggestionChannel({ service, guildId, userId, t, envelope, rateLimitGuard, values }) {
  if (!(await enforceConfigWrite({ guildId, userId, t, envelope, rateLimitGuard }))) return null;
  const channelId = values && values[0] ? values[0] : null;
  return service.update(guildId, { [Key.CHANNEL_ID]: channelId });
}

module.exports = { toggleSuggestion, selectSuggestionChannel };
