"use strict";

const { channelLabel } = require("../services/logLabels");

async function handleChannelEvent({ channel, config, action, target = null, who = undefined, before = null, after = null, mapper, service, delivery }) {
  if (!config.logs_enabled) return null;

  const details = {
    target: target || channelLabel(channel),
    channelId: channel.id || null,
  };
  if (before) details.before = before;
  if (after) details.after = after;
  // `who` = auteur de l'action, résolu via Audit Log par l'appelant.
  if (who !== undefined) details.who = who;

  const entry = mapper.map({
    guildId: channel.guild.id,
    channelKey: "log_channel_update_channel_id",
    category: "channels",
    action,
    title: `logs.${action}`,
    details,
  });
  return delivery.deliver({ ...entry, channelId: service.resolveDestination(entry, config) });
}

module.exports = { handleChannelEvent };
