"use strict";

const { userLabel, channelLabel } = require("../services/logLabels");

async function handleMessageUpdated({ message, oldMessage, config, mapper, service, delivery }) {
  if (!config.logs_enabled || !message.guild || message.author?.bot) return null;
  const entry = mapper.map({
    guildId: message.guild.id,
    channelKey: "log_message_edit_channel_id",
    category: "messages",
    action: "message_updated",
    title: "logs.messageUpdated",
    // Avant/Après seulement si les contenus sont réellement disponibles
    // (messages non partiels) ; sinon omis, jamais inventés.
    details: {
      who: userLabel(message.author),
      channel: channelLabel(message.channel),
      before: oldMessage?.content || null,
      after: message.content || null,
      messageId: message.id || null,
      channelId: message.channelId || null,
    },
  });
  return delivery.deliver({ ...entry, channelId: service.resolveDestination(entry, config) });
}

module.exports = { handleMessageUpdated };
