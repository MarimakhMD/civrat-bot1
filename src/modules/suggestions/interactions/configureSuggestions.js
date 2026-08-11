"use strict";

const { SuggestionComponentId: Id, SuggestionConfigKey: Key } = require("../configuration/suggestionConstants");

async function toggleSuggestion({ service, guildId }) {
  const config = await service.read(guildId);
  return service.update(guildId, { [Key.ENABLED]: !config[Key.ENABLED] });
}

async function selectSuggestionChannel({ service, guildId, values }) {
  const channelId = values && values[0] ? values[0] : null;
  return service.update(guildId, { [Key.CHANNEL_ID]: channelId });
}

module.exports = { toggleSuggestion, selectSuggestionChannel };
