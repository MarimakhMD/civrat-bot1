"use strict";

const { userLabel, channelLabel } = require("../services/logLabels");

async function handleMessageDeleted({ message, config, mapper, service, delivery }) {
  if (!config.logs_enabled || !message.guild || message.author?.bot) return null;
  const entry = mapper.map({
    guildId: message.guild.id,
    channelKey: "log_message_delete_channel_id",
    category: "messages",
    action: "message_deleted",
    title: "logs.messageDeleted",
    // `who` vaut null pour un message partiel (hors cache) : le transport
    // affichera « inconnu ». Le contenu supprimé n'est conservé que s'il est
    // réellement disponible (jamais inventé).
    details: {
      who: userLabel(message.author),
      channel: channelLabel(message.channel),
      before: message.content || null,
      messageId: message.id || null,
      channelId: message.channelId || null,
    },
  });
  const channelId = service.resolveDestination(entry, config);
  return delivery.deliver({ ...entry, channelId });
}

module.exports = { handleMessageDeleted };
