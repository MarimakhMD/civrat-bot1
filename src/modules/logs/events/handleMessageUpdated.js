"use strict";

const { userLabel, channelLabel, avatarUrl } = require("../services/logLabels");
const { localizeTitle } = require("../services/logTitles");
const { resolveLanguage } = require("../services/logLanguage");

async function handleMessageUpdated({ message, oldMessage, config, mapper, service, delivery }) {
  if (!config.logs_enabled || !message.guild || message.author?.bot) return null;
  const entry = mapper.map({
    guildId: message.guild.id,
    channelKey: "log_message_edit_channel_id",
    // PHASE 1 — catégorie alignée sur la clé de salon (éditions, pas suppressions).
    category: "messages_edit",
    language: resolveLanguage(config),
    action: "message_updated",
    title: localizeTitle(config, "logs.messageUpdated"),
    // Avant/Après seulement si les contenus sont réellement disponibles
    // (messages non partiels) ; sinon omis, jamais inventés.
    details: {
      who: userLabel(message.author),
      channel: channelLabel(message.channel),
      before: oldMessage?.content || null,
      after: message.content || null,
      messageId: message.id || null,
      channelId: message.channelId || null,
      avatarUrl: avatarUrl(message.author),
    },
  });
  return delivery.deliver({ ...entry, channelId: service.resolveDestination(entry, config) });
}

module.exports = { handleMessageUpdated };
