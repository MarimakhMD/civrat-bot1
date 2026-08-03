const automodService = require("../services/automodService");
const xpService = require("../services/xpService");
const mongoose = require("mongoose");
const logger = require("../utils/logger");
const guildConfigService = require("../services/guildConfig");

const CountingGame = mongoose.models.CountingGame || mongoose.model("CountingGame", new mongoose.Schema({
  guildId: { type: String, required: true, unique: true }, lastNumber: { type: Number, default: 0 }, lastUserId: { type: String, default: null }, lastMessageTime: { type: Date, default: Date.now },
}));

module.exports = { name: "messageCreate", once: false, async execute(message) {
  try {
    if (message.author.bot || !message.guild) return;
    const config = await guildConfigService.getGuildConfig(message.guild.id);
    if (!config) return;
    if (await automodService.handleMessage(message, config)) return;
    await xpService.awardXp(message, config);
    await handleCounting(message);
  } catch (error) { logger.error("messageCreate failed:", error.message); }
} };

async function handleCounting(message) {
  const countingChannelId = "1490014117745004637";
  if (message.channel.id !== countingChannelId) return;
  const number = Number.parseInt(message.content.trim(), 10);
  if (!Number.isInteger(number)) return message.delete().catch(() => {});
  try {
    const game = await CountingGame.findOneAndUpdate({ guildId: message.guild.id }, {}, { new: true, upsert: true });
    if (number !== (game.lastNumber || 0) + 1 || message.author.id === game.lastUserId) return message.delete().catch(() => {});
    game.lastNumber = number; game.lastUserId = message.author.id; game.lastMessageTime = new Date(); await game.save(); await message.react("✅").catch(() => {});
  } catch (error) { logger.error("Counting error:", error.message); }
}
