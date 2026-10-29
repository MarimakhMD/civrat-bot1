"use strict";

// Moderation-only policy. Do not reuse timeout capabilities for other actions.
function has(member, permission) {
  try { return member?.permissions?.has?.(permission) === true; }
  catch { return false; }
}
function above(actor, target, guild, { allowSelf = false } = {}) {
  if (!actor?.id || !target?.id || !guild?.id) return false;
  if (target.id === guild.ownerId) return false;
  if (actor.guild?.id && actor.guild.id !== guild.id) return false;
  if (target.guild?.id && target.guild.id !== guild.id) return false;
  if (actor.id === target.id) return allowSelf;
  if (actor.id === guild.ownerId) return true;
  const a = actor.roles?.highest, b = target.roles?.highest;
  if (!a || !b) return false;
  if (typeof a.comparePositionTo === "function") {
    try { return a.comparePositionTo(b) > 0; } catch { return false; }
  }
  return Number.isFinite(a.position) && Number.isFinite(b.position) && a.position > b.position;
}
function isBot(member) { return member?.user?.bot === true || member?.bot === true; }
function protectedTarget(guild, id) {
  // Missing bot identity is an incomplete security context, not permission.
  const botId = guild?.members?.me?.id || guild?.client?.user?.id;
  return !botId || id === botId;
}
function canAct(guild, actor, target, action) {
  if (!guild?.id || actor?.guild?.id !== guild.id || target?.guild?.id !== guild.id) return false;
  if (!target || protectedTarget(guild, target.id) || !above(actor, target, guild, { allowSelf: action === "nickname" })) return false;
  const permissions = { warn: "ModerateMembers", timeout: "ModerateMembers", ban: "BanMembers", kick: "KickMembers", nickname: "ManageNicknames" };
  if (!permissions[action] || !has(actor, permissions[action])) return false;
  if (action === "warn") return !isBot(target); // logical warning: no bot timeout prerequisite
  if (!has(guild.members?.me, permissions[action]) || !above(guild.members.me, target, guild)) return false;
  if (action === "timeout") return !isBot(target) && target.moderatable === true;
  if (action === "ban") return target.bannable === true;
  if (action === "kick") return target.kickable === true;
  return target.manageable === true;
}
function matchesGuild(guildId, actor, transport) {
  return Boolean(guildId && (!actor?.guild?.id || actor.guild.id === guildId)
    && (!transport?.guild?.id || transport.guild.id === guildId));
}
module.exports = { has, above, isBot, protectedTarget, canAct, matchesGuild };
