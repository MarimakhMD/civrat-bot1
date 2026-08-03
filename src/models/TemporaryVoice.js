const mongoose = require("mongoose");
const schema = new mongoose.Schema({ guildId: { type: String, required: true }, channelId: { type: String, required: true, unique: true }, ownerId: { type: String, required: true }, categoryId: { type: String, required: true } }, { timestamps: true });
schema.index({ guildId: 1, ownerId: 1 }, { unique: true });
module.exports = mongoose.models.TemporaryVoice || mongoose.model("TemporaryVoice", schema);
