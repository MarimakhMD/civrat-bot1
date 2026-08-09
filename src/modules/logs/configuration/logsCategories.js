"use strict";
const LogsCategory=Object.freeze({MESSAGES:"messages",MEMBERS:"members",MODERATION:"moderation",ROLES:"roles",CHANNELS:"channels",INVITATIONS:"invitations"});
const LogsCategoryChannelKey=Object.freeze({[LogsCategory.MESSAGES]:"log_message_delete_channel_id",[LogsCategory.MEMBERS]:"log_member_join_channel_id",[LogsCategory.MODERATION]:"log_moderation_channel_id",[LogsCategory.ROLES]:"log_role_update_channel_id",[LogsCategory.CHANNELS]:"log_channel_update_channel_id",[LogsCategory.INVITATIONS]:"invitations_log_channel_id"});
module.exports={LogsCategory,LogsCategoryChannelKey};
