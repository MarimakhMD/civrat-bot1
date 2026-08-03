const mongoose = require("mongoose");
const { PermissionsBitField } = require("discord.js");
const UserXP = require("../models/UserXP");
const logger = require("../utils/logger");

function levelFromXp(xp) { return Math.floor(Math.sqrt(Math.max(0, xp) / 100)); }
function xpForLevel(level) { return 100 * Math.pow(level, 2); }
function xpForNextLevel(level) { return xpForLevel(level + 1); }
function mongoReady() { return mongoose.connection.readyState === 1; }

async function awardXp(message, config) {
  if (!config.xp_enabled || message.author.bot || !message.guild || !mongoReady()) return null;
  const gain = Math.max(1, Number(config.xp_per_message) || 1);
  const cooldownMs = Math.max(0, Number(config.xp_cooldown) || 0) * 1000;
  try {
    let profile = await UserXP.findOne({ guildId: message.guild.id, userId: message.author.id });
    const now = new Date();
    if (profile && profile.lastXpAt && now.getTime() - profile.lastXpAt.getTime() < cooldownMs) return null;
    if (!profile) profile = new UserXP({ guildId: message.guild.id, userId: message.author.id });
    const previousLevel = profile.level;
    profile.xp += gain;
    profile.totalMessages += 1;
    profile.lastXpAt = now;
    profile.level = levelFromXp(profile.xp);
    await profile.save();
    if (profile.level > previousLevel) await handleLevelUp(message.member, message.guild, config, profile, previousLevel);
    return profile;
  } catch (error) {
    logger.error(`XP award failed for ${message.guild.id}:${message.author.id}:`, error.message);
    return null;
  }
}

async function handleLevelUp(member, guild, config, profile, previousLevel) {
  const gainedRoles = [];
  for (const reward of config.role_rewards || []) {
    if (!Number.isInteger(reward.level) || reward.level <= previousLevel || reward.level > profile.level || !reward.role_id) continue;
    const role = guild.roles.cache.get(reward.role_id);
    if (!role || member.roles.cache.has(role.id) || !member.manageable) continue;
    try { await member.roles.add(role, `CIVRAT XP niveau ${profile.level}`); gainedRoles.push(role); }
    catch (error) { logger.warn(`XP role reward failed for ${member.id}:${role.id}: ${error.message}`); }
  }
  await announceLevel(member, guild, config, profile, gainedRoles);
}

async function announceLevel(member, guild, config, profile, roles) {
  const channel = guild.channels.cache.get(config.xp_announce_channel_id);
  if (!channel?.isTextBased?.() || !guild.members.me || !channel.permissionsFor(guild.members.me)?.has(PermissionsBitField.Flags.SendMessages)) return;
  const rewards = roles.length ? ` Récompense${roles.length > 1 ? "s" : ""} : ${roles.join(", ")}.` : "";
  try { await channel.send(`🎉 ${member}, tu passes au **niveau ${profile.level}** avec **${profile.xp} XP** !${rewards}`); }
  catch (error) { logger.error(`XP announcement failed for ${guild.id}:`, error.message); }
}

async function getProfile(guildId, userId) {
  if (!mongoReady()) return null;
  return UserXP.findOne({ guildId, userId }).lean().catch(() => null);
}
async function getLeaderboard(guildId, limit = 10) {
  if (!mongoReady()) return [];
  return UserXP.find({ guildId }).sort({ xp: -1 }).limit(limit).lean().catch(() => []);
}
async function getRank(guildId, userId, xp) {
  if (!mongoReady()) return null;
  const ahead = await UserXP.countDocuments({ guildId, xp: { $gt: xp } }).catch(() => null);
  return ahead === null ? null : ahead + 1;
}

module.exports = { awardXp, getProfile, getLeaderboard, getRank, levelFromXp, xpForLevel, xpForNextLevel };
