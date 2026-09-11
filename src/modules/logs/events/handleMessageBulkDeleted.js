"use strict";

const { userLabel, channelLabel } = require("../services/logLabels");

const MAX_SUMMARY_MESSAGES = 10;
const MAX_EXCERPT_LENGTH = 120;

async function handleMessageBulkDeleted({ messages, config, mapper, service, delivery }) {
  const first = messages.first();
  if (!config.logs_enabled || !first?.guild) return null;
  const entry = mapper.map({
    guildId: first.guild.id,
    channelKey: "log_message_delete_channel_id",
    category: "messages",
    action: "messages_bulk_deleted",
    title: "logs.messagesBulkDeleted",
    details: {
      channel: channelLabel(first.channel),
      before: summarizeMessages(messages),
      count: messages.size,
    },
  });
  return delivery.deliver({ ...entry, channelId: service.resolveDestination(entry, config) });
}

// Résumé best-effort des messages supprimés (auteur + extrait), plafonné pour
// ne jamais dépasser les limites d'un champ d'embed. Les auteurs inconnus sont
// explicitement marqués « inconnu » ; aucun contenu n'est inventé.
function summarizeMessages(messages) {
  const items = [];
  const iterable = typeof messages.map === "function" ? messages.map((m) => m) : messages.values ? [...messages.values()] : [];
  for (const message of iterable) {
    if (items.length >= MAX_SUMMARY_MESSAGES) break;
    if (!message || typeof message !== "object") continue;
    const author = userLabel(message.author) || "inconnu";
    const content = typeof message.content === "string" ? message.content.trim() : "";
    const excerpt = content.length > MAX_EXCERPT_LENGTH
      ? `${content.slice(0, MAX_EXCERPT_LENGTH)}…`
      : content;
    items.push(excerpt ? `${author} : ${excerpt}` : author);
  }
  return items.length > 0 ? items.join("\n") : null;
}

module.exports = { handleMessageBulkDeleted };
