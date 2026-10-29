"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
// No dependency installation: stub only SDK flag constants while loading the
// actual permission map and capability. This is not a live discord.js test.
const Module = require("node:module");
const originalLoad = Module._load;
const flags = Object.fromEntries(["Administrator","ManageGuild","ManageRoles","ManageChannels","ModerateMembers","BanMembers","KickMembers","ManageMessages","ManageNicknames"].map((key,i)=>[key,1n<<BigInt(i)]));
let createDiscordMemberCapability;
try {
  Module._load = function (id, ...args) {
    return id === "discord.js" ? { PermissionsBitField: { Flags: flags } } : originalLoad.call(this,id,...args);
  };
  ({ createDiscordMemberCapability } = require("../../../src/adapters/discord/DiscordMemberCapability"));
} finally { Module._load = originalLoad; }
const { PermissionName } = require("../../../src/core/permissions");
test("capability maps scoped permission and uses effective channel grant/deny, not guild rights",()=>{
 const member={id:'actor',guild:{id:'g'},permissions:{has:()=>false}};
 const c=createDiscordMemberCapability(member,'owner');let seen;
 const channel={guildId:'g',permissionsFor:m=>{assert.equal(m,member);return {has:p=>{seen=p;return true;}}}};
 assert.equal(c.hasInChannel(PermissionName.MANAGE_MESSAGES,channel),true);assert.equal(seen,flags.ManageMessages);
 assert.equal(c.has(PermissionName.MANAGE_MESSAGES),false);
 member.permissions.has=()=>true;channel.permissionsFor=()=>({has:()=>false});assert.equal(c.hasInChannel(PermissionName.MANAGE_MESSAGES,channel),false);
 assert.equal(c.has(PermissionName.MANAGE_MESSAGES),true);
});
test("channel capability rejects unknown permissions, owner pseudo-permission and cross-guild/missing contexts",()=>{
 const c=createDiscordMemberCapability({id:'owner',guild:{id:'g'}},'owner');
 const channel={guildId:'g',permissionsFor:()=>({has:()=>true})};
 for(const permission of ['UNKNOWN','toString',PermissionName.GUILD_OWNER])assert.equal(c.hasInChannel(permission,channel),false);
 assert.equal(c.has(PermissionName.GUILD_OWNER),true);
 for(const ch of [null,{}, {...channel,guildId:'other'}])assert.equal(c.hasInChannel(PermissionName.MANAGE_MESSAGES,ch),false);
 assert.equal(createDiscordMemberCapability(null,null).hasInChannel(PermissionName.MANAGE_MESSAGES,channel),false);
 assert.equal(createDiscordMemberCapability({id:'a'},null).hasInChannel(PermissionName.MANAGE_MESSAGES,channel),false);
 channel.permissionsFor=()=>{throw Error('unavailable')};assert.equal(c.hasInChannel(PermissionName.MANAGE_MESSAGES,channel),false);
});
