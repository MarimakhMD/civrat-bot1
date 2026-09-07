"use strict";

// Catégories de logs configurables depuis /settings → Logs.
//
// Phase 1 (C11) : deux catégories manquaient, alors que leurs clés de salon
// sont réellement lues par les handlers :
//   • log_message_edit_channel_id  ← handleMessageUpdated.js
//   • log_member_leave_channel_id  ← handleMemberLeft.js
// Sans entrée ici, `service.resolveDestination()` retournait toujours null et
// ces deux logs étaient silencieusement jetés, sans aucun moyen de les activer.
//
// La valeur de chaque catégorie sert à trois choses à la fois : valeur du
// select de /settings, suffixe du customId `civrat:v1:logs:channel:<categorie>`
// et suffixe de la clé de traduction `logs.<categorie>` — toute nouvelle
// catégorie exige donc sa clé dans translations/fr.json ET translations/en.json
// (I18nService lève sur clé absente). Garde : test/runtime/
// settings-config-key-coverage.test.js.
const LogsCategory = Object.freeze({
  MESSAGES: "messages",
  MESSAGES_EDIT: "messages_edit",
  MEMBERS: "members",
  MEMBERS_LEAVE: "members_leave",
  MODERATION: "moderation",
  ROLES: "roles",
  CHANNELS: "channels",
  INVITATIONS: "invitations",
});

// Une catégorie = exactement une clé de salon dans guild_configs.
const LogsCategoryChannelKey = Object.freeze({
  [LogsCategory.MESSAGES]: "log_message_delete_channel_id",
  [LogsCategory.MESSAGES_EDIT]: "log_message_edit_channel_id",
  [LogsCategory.MEMBERS]: "log_member_join_channel_id",
  [LogsCategory.MEMBERS_LEAVE]: "log_member_leave_channel_id",
  [LogsCategory.MODERATION]: "log_moderation_channel_id",
  [LogsCategory.ROLES]: "log_role_update_channel_id",
  [LogsCategory.CHANNELS]: "log_channel_update_channel_id",
  [LogsCategory.INVITATIONS]: "invitations_log_channel_id",
});

module.exports = { LogsCategory, LogsCategoryChannelKey };
