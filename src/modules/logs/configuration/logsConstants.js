"use strict";
const LogsConfigKey=Object.freeze({ENABLED:"logs_enabled",MESSAGES_DELETE:"log_message_delete_channel_id",MESSAGES_EDIT:"log_message_edit_channel_id",MEMBERS_JOIN:"log_member_join_channel_id",MEMBERS_LEAVE:"log_member_leave_channel_id",MODERATION:"log_moderation_channel_id",ROLES:"log_role_update_channel_id",CHANNELS:"log_channel_update_channel_id",INVITATIONS:"invitations_log_channel_id"});
const LogsComponentId=Object.freeze({SECTION:"civrat:v1:logs:section",TOGGLE:"civrat:v1:logs:toggle",CATEGORY:"civrat:v1:logs:category",CHANNEL_PREFIX:"civrat:v1:logs:channel",PREVIEW:"civrat:v1:logs:preview",BACK:"civrat:v1:logs:back"});
module.exports={LogsConfigKey,LogsComponentId};
