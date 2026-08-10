"use strict";
const test=require("node:test"),assert=require("node:assert/strict");const {createDiscordMemberCapability}=require("../../../src/adapters/discord");const {PermissionName}=require("../../../src/core/permissions");
test("Discord member capability exposes only core permission vocabulary",()=>{const capability=createDiscordMemberCapability({id:"owner",permissions:{has:()=>true}},"owner");assert.equal(capability.isGuildOwner,true);assert.equal(capability.has(PermissionName.MANAGE_GUILD),true);});
