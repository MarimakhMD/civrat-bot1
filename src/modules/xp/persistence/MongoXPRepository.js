"use strict";

const { XPRepository } = require("./XPRepository");

let UserXPModel = null;
try {
  const mongoose = require("mongoose");
  const schema = new mongoose.Schema(
    {
      guildId: { type: String, required: true, index: true },
      userId: { type: String, required: true, index: true },
      xp: { type: Number, default: 0 },
      level: { type: Number, default: 0 },
    },
    { timestamps: true }
  );
  schema.index({ guildId: 1, userId: 1 }, { unique: true });
  UserXPModel = mongoose.models.UserXP || mongoose.model("UserXP", schema);
} catch {}

class MongoXPRepository extends XPRepository {
  constructor({ model } = {}) {
    super();
    this.model = model || UserXPModel;
    if (!this.model) throw new Error("MongoXPRepository requires mongoose model");
  }

  async findOne(guildId, userId) {
    const doc = await this.model.findOne({ guildId, userId }).lean();
    if (!doc) return null;
    return { guildId: doc.guildId, userId: doc.userId, xp: doc.xp, level: doc.level };
  }

  async upsert(guildId, userId, xp, level) {
    const doc = await this.model.findOneAndUpdate({ guildId, userId }, { xp, level }, { upsert: true, new: true, setDefaultsOnInsert: true }).lean();
    return { guildId: doc.guildId, userId: doc.userId, xp: doc.xp, level: doc.level };
  }
}

module.exports = { MongoXPRepository, UserXPModel };
