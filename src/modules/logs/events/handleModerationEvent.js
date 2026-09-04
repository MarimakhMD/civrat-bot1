"use strict";
async function handleModerationEvent({ guild, config, action, targetId, reason = null, rule = null, rules = null, moderatorId = null, mapper, service, delivery }) {
  if (!config.logs_enabled) return null;
  const details = { targetId };
  if (reason) details.reason = reason;
  if (moderatorId) details.moderatorId = moderatorId;
  if (rule) details.rule = rule;
  if (Array.isArray(rules) && rules.length) details.rules = [...rules];
  const entry = mapper.map({ guildId: guild.id, channelKey: "log_moderation_channel_id", category: "moderation", action, title: `logs.${action}`, details });
  return delivery.deliver({ ...entry, channelId: service.resolveDestination(entry, config) });
}
module.exports = { handleModerationEvent };
