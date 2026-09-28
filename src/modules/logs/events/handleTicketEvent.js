"use strict";

// PHASE 1 — les logs Tickets passent par le même rendu que le reste du système.
//
// Avant : `title: \`logs.${action}\`` injectait la CLÉ de traduction brute comme
// titre d'embed (`logs.ticket_created` affiché tel quel), et `details` exposait
// les champs techniques `action` et `result`. Le titre est désormais résolu via
// `localizeTitle`, la langue est attachée à l'entrée, et seuls les
// identifiants réellement connus sont rendus.

const { localizeTitle } = require("../services/logTitles");
const { resolveLanguage } = require("../services/logLanguage");

async function handleTicketEvent({
  guild,
  config,
  action,
  ticketChannelId = null,
  userId = null,
  reason = null,
  mapper,
  service,
  delivery,
}) {
  if (!config.logs_enabled) return null;

  const details = {};
  if (ticketChannelId) details.ticketChannelId = ticketChannelId;
  if (userId) details.userId = userId;
  if (reason) details.reason = reason;

  const entry = mapper.map({
    guildId: guild.id,
    channelKey: "log_moderation_channel_id",
    category: "moderation",
    language: resolveLanguage(config),
    action,
    title: localizeTitle(config, `logs.${action}`),
    details,
  });

  return delivery.deliver({ ...entry, channelId: service.resolveDestination(entry, config) });
}

module.exports = { handleTicketEvent };
