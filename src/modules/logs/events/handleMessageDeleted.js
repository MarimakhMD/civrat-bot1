"use strict";

async function handleMessageDeleted({ message, config, mapper, service, delivery }) {
  if (!config.logs_enabled || !message.guild || message.author?.bot) return null;
  const entry = mapper.map({
    guildId: message.guild.id,
    channelKey: "log_message_delete_channel_id",
    category: "messages",
    action: "message_deleted",
    title: "logs.messageDeleted",
    // Pour un message partiel (hors cache), `author` vaut null : on n'invente
    // rien, on conserve ce qui est réellement disponible.
    details: {
      messageId: message.id,
      channelId: message.channelId,
      authorId: message.author?.id ?? null,
    },
  });
  const channelId = service.resolveDestination(entry, config);
  return delivery.deliver({ ...entry, channelId });
}

module.exports = { handleMessageDeleted };
