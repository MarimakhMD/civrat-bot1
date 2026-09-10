"use strict";

async function handleMessageUpdated({ message, config, mapper, service, delivery }) {
  if (!config.logs_enabled || !message.guild || message.author?.bot) return null;
  const entry = mapper.map({
    guildId: message.guild.id,
    channelKey: "log_message_edit_channel_id",
    category: "messages",
    action: "message_updated",
    title: "logs.messageUpdated",
    // Pour un message partiel, `author`/`content` peuvent être indisponibles :
    // on conserve uniquement les identifiants connus, sans inventer de données.
    details: {
      messageId: message.id,
      channelId: message.channelId,
      authorId: message.author?.id ?? null,
    },
  });
  return delivery.deliver({ ...entry, channelId: service.resolveDestination(entry, config) });
}

module.exports = { handleMessageUpdated };
