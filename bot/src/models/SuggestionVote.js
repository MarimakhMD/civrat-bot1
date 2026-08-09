const mongoose = require("mongoose");
const schema = new mongoose.Schema({ suggestionId: { type: Number, required: true }, userId: { type: String, required: true }, vote: { type: Number, enum: [-1, 1], required: true } }, { timestamps: true });
schema.index({ suggestionId: 1, userId: 1 }, { unique: true });
module.exports = mongoose.models.SuggestionVote || mongoose.model("SuggestionVote", schema);
