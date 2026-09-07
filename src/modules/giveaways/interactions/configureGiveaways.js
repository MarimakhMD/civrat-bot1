"use strict";

const { GiveawayConfigKey: Key } = require("../configuration/giveawayConstants");

async function toggleGiveaway({ service, guildId }) {
  const config = await service.read(guildId);
  return service.update(guildId, { [Key.ENABLED]: !config[Key.ENABLED] });
}

// C1 : selectGiveawayChannel a été SUPPRIMÉ.
// Il écrivait giveaway_channel_id, colonne qui n'existe pas dans guild_configs
// et qui ne doit pas être créée : l'upsert était rejeté par PostgREST et le
// salon choisi n'était jamais pris en compte. Le salon de publication est
// désormais celui où /giveaway create est exécuté.
// L'import GiveawayComponentId est retiré : il n'était déjà plus utilisé.

module.exports = { toggleGiveaway };
