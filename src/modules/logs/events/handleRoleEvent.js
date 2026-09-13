"use strict";

const { localizeTitle } = require("../services/logTitles");

async function handleRoleEvent({
  guild,
  config,
  action,
  roleId,
  memberId = null,
  target = null,
  member = null,
  who = undefined,
  before = null,
  after = null,
  avatarUrl = null,
  mapper,
  service,
  delivery,
}) {
  if (!config.logs_enabled) return null;

  const details = {};
  if (roleId) details.roleId = roleId;
  if (memberId) details.memberId = memberId;
  if (target) details.target = target;
  if (member) details.member = member;
  if (before) details.before = before;
  if (after) details.after = after;
  if (avatarUrl) details.avatarUrl = avatarUrl;
  // `who` = auteur de l'action, résolu via Audit Log par l'appelant. Absent →
  // omis ; null → « inconnu » (jamais d'identité inventée).
  if (who !== undefined) details.who = who;

  const entry = mapper.map({
    guildId: guild.id,
    channelKey: "log_role_update_channel_id",
    category: "roles",
    action,
    title: localizeTitle(config, `logs.${action}`),
    details,
  });
  return delivery.deliver({ ...entry, channelId: service.resolveDestination(entry, config) });
}

module.exports = { handleRoleEvent };
