"use strict";
const { PermissionName } = require("../../../core/permissions");
const settingsCommand = Object.freeze({ name: "settings", description: "⚙️ CIVRAT", permissions: { allOf: [PermissionName.MANAGE_GUILD] } });
module.exports = { settingsCommand };
