// ═══════════════════════════════════════════════════
// INVITE SERVICE - Persistent invite tracking (MongoDB)
// ═══════════════════════════════════════════════════

const mongoose = require("mongoose");
const logger = require("../utils/logger");

// In-memory cache of guild invites for tracking
const invitesCache = new Map();

// MongoDB model for invite stats
const inviteStatsSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  guildId: { type: String, required: true },
  total: { type: Number, default: 0 },
  left: { type: Number, default: 0 },
  current: { type: Number, default: 0 },
  invitedBy: { type: String, default: null },
}, { timestamps: true });

inviteStatsSchema.index({ userId: 1, guildId: 1 }, { unique: true });

let InviteStats;
try {
  InviteStats = mongoose.model("InviteStats", inviteStatsSchema);
} catch {
  InviteStats = mongoose.model("InviteStats");
}

function cacheGuildInvites(guildId, invites) {
  const map = new Map();
  for (const inv of invites.values()) {
    map.set(inv.code, { uses: inv.uses, inviter: inv.inviter });
  }
  invitesCache.set(guildId, map);
}

function hasCachedGuild(guildId) { return invitesCache.has(guildId); }

function findUsedInvite(guildId, newInvites) {
  const oldInvites = invitesCache.get(guildId);
  if (!oldInvites || !newInvites) return null;

  for (const invite of newInvites.values()) {
    const old = oldInvites.get(invite.code);
    if (old && invite.uses > old.uses) {
      cacheGuildInvites(guildId, newInvites);
      return { code: invite.code, inviter: invite.inviter };
    }
  }

  cacheGuildInvites(guildId, newInvites);
  return null;
}

async function addInvite(inviterId, guildId) {
  try {
    await InviteStats.findOneAndUpdate(
      { userId: inviterId, guildId },
      { $inc: { total: 1, current: 1 } },
      { upsert: true }
    );
  } catch (err) {
    logger.error(`Failed to add invite for ${inviterId}:`, err.message);
  }
}

async function setInvitedBy(userId, guildId, inviterId) {
  try {
    await InviteStats.findOneAndUpdate(
      { userId, guildId },
      { $set: { invitedBy: inviterId } },
      { upsert: true }
    );
  } catch (err) {
    logger.error(`Failed to set invitedBy for ${userId}:`, err.message);
  }
}

async function removeInvite(inviterId, guildId) {
  try {
    await InviteStats.findOneAndUpdate(
      { userId: inviterId, guildId },
      { $inc: { left: 1, current: -1 } },
      { upsert: true }
    );
  } catch (err) {
    logger.error(`Failed to remove invite for ${inviterId}:`, err.message);
  }
}

async function getInviteStats(userId, guildId) {
  try {
    const data = await InviteStats.findOne({ userId, guildId });
    if (!data) return { total: 0, left: 0, current: 0, fake: null, net: 0 };
    return { total: data.total, left: data.left, current: Math.max(0, data.current), fake: null, net: Math.max(0, data.current) };
  } catch {
    return { total: 0, left: 0, current: 0, fake: null, net: 0 };
  }
}

async function getLeaderboard(guildId, limit = 10) {
  try {
    return await InviteStats.find({ guildId }).sort({ current: -1, total: -1 }).limit(limit).lean();
  } catch (err) {
    logger.error(`Failed to get invite leaderboard for ${guildId}:`, err.message);
    return [];
  }
}

async function refreshGuildInvites(guild) {
  try {
    const invites = await guild.invites.fetch();
    cacheGuildInvites(guild.id, invites);
    return invites;
  } catch (err) {
    logger.warn(`Could not refresh invites for ${guild.id}: ${err.message}`);
    return null;
  }
}

module.exports = {
  cacheGuildInvites,
  hasCachedGuild,
  findUsedInvite,
  addInvite,
  setInvitedBy,
  removeInvite,
  getInviteStats,
  getLeaderboard,
  refreshGuildInvites,
};
