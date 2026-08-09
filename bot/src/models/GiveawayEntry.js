const mongoose = require("mongoose");
const giveawayEntrySchema = new mongoose.Schema({
  giveawayId: { type: Number, required: true },
  guildId: { type: String, required: true },
  userId: { type: String, required: true },
}, { timestamps: true });
giveawayEntrySchema.index({ giveawayId: 1, userId: 1 }, { unique: true });
giveawayEntrySchema.index({ giveawayId: 1 });
module.exports = mongoose.models.GiveawayEntry || mongoose.model("GiveawayEntry", giveawayEntrySchema);
