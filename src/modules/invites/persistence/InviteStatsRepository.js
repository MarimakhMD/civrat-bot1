"use strict";

class InviteStatsRepository {
  async addInvite(userId, guildId) { throw new Error("Not implemented"); }
  async removeInvite(userId, guildId) { throw new Error("Not implemented"); }
  async setInvitedBy(memberId, guildId, inviterId) { throw new Error("Not implemented"); }
  async getInviteStats(userId, guildId) { throw new Error("Not implemented"); }
  async findOne(guildId, userId) { throw new Error("Not implemented"); }
}

class InMemoryInviteStatsRepository extends InviteStatsRepository {
  constructor() {
    super();
    this.invites = new Map(); // guildId:userId -> count
    this.invitedBy = new Map(); // guildId:memberId -> inviterId
  }

  _key(guildId, userId) { return `${guildId}:${userId}`; }

  async addInvite(userId, guildId) {
    const key = this._key(guildId, userId);
    const current = this.invites.get(key) || 0;
    this.invites.set(key, current + 1);
    return { userId, guildId, current: current + 1 };
  }

  async removeInvite(userId, guildId) {
    const key = this._key(guildId, userId);
    const current = this.invites.get(key) || 0;
    const next = Math.max(0, current - 1);
    this.invites.set(key, next);
    return { userId, guildId, current: next };
  }

  async setInvitedBy(memberId, guildId, inviterId) {
    this.invitedBy.set(this._key(guildId, memberId), inviterId);
    return { memberId, guildId, inviterId };
  }

  async getInviteStats(userId, guildId) {
    const key = this._key(guildId, userId);
    const current = this.invites.get(key) || 0;
    const invitedBy = this.invitedBy.get(key) || null;
    return { userId, guildId, current, invitedBy };
  }

  async findOne(guildId, userId) {
    const stats = await this.getInviteStats(userId, guildId);
    if (stats.current === 0 && !stats.invitedBy) return null;
    return stats;
  }

  clear() {
    this.invites.clear();
    this.invitedBy.clear();
  }
}

class MongoInviteStatsRepository extends InviteStatsRepository {
  constructor({ model } = {}) {
    super();
    let Model = model;
    if (!Model) {
      try {
        const mongoose = require("mongoose");
        const schema = new mongoose.Schema({
          guildId: { type: String, required: true, index: true },
          userId: { type: String, required: true, index: true },
          invites: { type: Number, default: 0 },
          invitedBy: { type: String, default: null },
        }, { timestamps: true });
        schema.index({ guildId: 1, userId: 1 }, { unique: true });
        Model = mongoose.models.InviteStats || mongoose.model("InviteStats", schema);
      } catch {
        throw new Error("MongoInviteStatsRepository requires mongoose model");
      }
    }
    this.model = Model;
  }

  async addInvite(userId, guildId) {
    const doc = await this.model.findOneAndUpdate({ guildId, userId }, { $inc: { invites: 1 } }, { upsert: true, new: true });
    return { userId, guildId, current: doc.invites };
  }

  async removeInvite(userId, guildId) {
    const doc = await this.model.findOneAndUpdate({ guildId, userId }, { $inc: { invites: -1 } }, { new: true });
    const current = doc ? Math.max(0, doc.invites) : 0;
    if (doc && doc.invites < 0) await this.model.updateOne({ guildId, userId }, { invites: 0 });
    return { userId, guildId, current };
  }

  async setInvitedBy(memberId, guildId, inviterId) {
    await this.model.findOneAndUpdate({ guildId, userId: memberId }, { invitedBy: inviterId }, { upsert: true });
    return { memberId, guildId, inviterId };
  }

  async getInviteStats(userId, guildId) {
    const doc = await this.model.findOne({ guildId, userId }).lean();
    if (!doc) return { userId, guildId, current: 0, invitedBy: null };
    return { userId, guildId, current: doc.invites || 0, invitedBy: doc.invitedBy || null };
  }

  async findOne(guildId, userId) {
    const doc = await this.model.findOne({ guildId, userId }).lean();
    if (!doc) return null;
    return { guildId, userId, current: doc.invites, invitedBy: doc.invitedBy };
  }
}

module.exports = { InviteStatsRepository, InMemoryInviteStatsRepository, MongoInviteStatsRepository };
