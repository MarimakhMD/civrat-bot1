"use strict";

const { channelLabel, channelTypeLabel } = require("../services/logLabels");
const { localizeTitle } = require("../services/logTitles");
const { resolveLanguage } = require("../services/logLanguage");

async function handleChannelEvent({
  channel,
  config,
  action,
  target = null,
  who = undefined,
  before = null,
  after = null,
  permissions = null,
  parent = null,
  mapper,
  service,
  delivery,
}) {
  if (!config.logs_enabled) return null;

  const details = {
    target: target || channelLabel(channel),
    channelId: channel.id || null,
    channelType: channelTypeLabel(channel),
  };
  if (parent) details.parent = parent;
  if (before) details.before = before;
  if (after) details.after = after;
  // PHASE 1 — surcharges de permissions dans un champ dédié.
  if (permissions) details.permissions = permissions;
  // `who` = auteur de l'action, résolu via Audit Log par l'appelant.
  if (who !== undefined) details.who = who;

  const entry = mapper.map({
    guildId: channel.guild.id,
    channelKey: "log_channel_update_channel_id",
    category: "channels",
    language: resolveLanguage(config),
    action,
    title: localizeTitle(config, `logs.${action}`),
    details,
  });
  return delivery.deliver({ ...entry, channelId: service.resolveDestination(entry, config) });
}

module.exports = { handleChannelEvent };
