"use strict";
const test=require("node:test"),assert=require("node:assert/strict");const {toDiscordCommand}=require("../../../src/adapters/discord");const {PermissionName}=require("../../../src/core/permissions");
test("Discord command adapter maps a neutral command definition",()=>{const command=toDiscordCommand({name:"settings",description:"⚙️ CIVRAT",permissions:{allOf:[PermissionName.MANAGE_GUILD]}},async()=>{});assert.equal(command.data.name,"settings");assert.equal(command.data.description,"⚙️ CIVRAT");assert.equal(typeof command.execute,"function");});
