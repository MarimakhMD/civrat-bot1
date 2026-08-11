"use strict";

const { TempVoiceComponentId: Id, TempVoiceConfigKey: Key } = require("../configuration/tempVoiceConstants");

async function toggleTempVoice({ service, guildId }) {
  const config = await service.read(guildId);
  return service.update(guildId, { [Key.ENABLED]: !config[Key.ENABLED] });
}

async function selectTempVoiceChannel({ service, guildId, customId, values }) {
  const channelId = values && values[0] ? values[0] : null;
  const key = customId === Id.LOBBY_CHANNEL ? Key.LOBBY_CHANNEL_ID : Key.CATEGORY_ID;
  return service.update(guildId, { [key]: channelId });
}

module.exports = { toggleTempVoice, selectTempVoiceChannel };
