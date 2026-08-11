"use strict";

const { GiveawayComponentId: Id, GiveawayConfigKey: Key } = require("../configuration/giveawayConstants");

async function toggleGiveaway({ service, guildId }) {
  const config = await service.read(guildId);
  return service.update(guildId, { [Key.ENABLED]: !config[Key.ENABLED] });
}

async function selectGiveawayChannel({ service, guildId, values }) {
  const channelId = values && values[0] ? values[0] : null;
  return service.update(guildId, { [Key.CHANNEL_ID]: channelId });
}

module.exports = { toggleGiveaway, selectGiveawayChannel };
