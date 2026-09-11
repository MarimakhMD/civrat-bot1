"use strict";

async function handleModerationEvent({
  guild,
  config,
  action,
  targetId,
  reason = null,
  rule = null,
  rules = null,
  moderatorId = null,
  target = undefined,
  moderator = undefined,
  mapper,
  service,
  delivery,
}) {
  if (!config.logs_enabled) return null;

  const details = {};
  if (targetId !== null && targetId !== undefined) details.targetId = targetId;
  if (target) details.target = target;
  if (reason) details.reason = reason;
  if (moderatorId) details.moderatorId = moderatorId;
  if (rule) details.rule = rule;
  if (Array.isArray(rules) && rules.length) details.rules = [...rules];
  // `who` n'est renseigné que lorsque l'appelant traite explicitement d'un
  // acteur (modération). `moderator === null` → « inconnu » ; absent → champ
  // omis (aucune identité inventée).
  if (moderator !== undefined) details.who = moderator;

  const entry = mapper.map({
    guildId: guild.id,
    channelKey: "log_moderation_channel_id",
    category: "moderation",
    action,
    title: `logs.${action}`,
    details,
  });
  return delivery.deliver({ ...entry, channelId: service.resolveDestination(entry, config) });
}

module.exports = { handleModerationEvent };
