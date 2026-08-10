"use strict";class DiscordAutoRoleTransport{async assignRole(member,role){await member.roles.add(role);return true;}}module.exports={DiscordAutoRoleTransport};
