const mongoose = require("mongoose");

const userXpSchema = new mongoose.Schema({
  guildId: { type: String, required: true, index: true },
  userId: { type: String, required: true },
  xp: { type: Number, default: 0, min: 0 },
  level: { type: Number, default: 0, min: 0 },
  lastXpAt: { type: Date, default: null },
  totalMessages: { type: Number, default: 0, min: 0 },
}, { timestamps: true });

userXpSchema.index({ guildId: 1, userId: 1 }, { unique: true });
userXpSchema.index({ guildId: 1, xp: -1 });

module.exports = mongoose.models.UserXP || mongoose.model("UserXP", userXpSchema);
