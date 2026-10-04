"use strict";

const { TempVoiceComponentId: Id, TempVoiceConfigKey: Key } = require("../configuration/tempVoiceConstants");
const { enforceConfigWrite } = require("../../../core/rateLimit/ActionRateLimitGuard");

// P6 §5 — écritures de configuration : garde AVANT read/upsert ; `null` au
// dépassement signale à l'appelant que la réponse éphémère est déjà partie.
async function toggleTempVoice({ service, guildId, userId, t, envelope, rateLimitGuard }) {
  if (!(await enforceConfigWrite({ guildId, userId, t, envelope, rateLimitGuard }))) return null;
  const config = await service.read(guildId);
  return service.update(guildId, { [Key.ENABLED]: !config[Key.ENABLED] });
}

async function selectTempVoiceChannel({ service, guildId, userId, t, envelope, rateLimitGuard, customId, values }) {
  if (!(await enforceConfigWrite({ guildId, userId, t, envelope, rateLimitGuard }))) return null;
  const channelId = values && values[0] ? values[0] : null;
  const key = customId === Id.LOBBY_CHANNEL ? Key.LOBBY_CHANNEL_ID : Key.CATEGORY_ID;
  return service.update(guildId, { [key]: channelId });
}

module.exports = { toggleTempVoice, selectTempVoiceChannel };
