const { ChannelType, PermissionsBitField } = require("discord.js");
const { mongoose } = require("../config/database");
const TemporaryVoice = require("../models/TemporaryVoice");
const { sendLog } = require("./logService");
const { getGuildConfig } = require("./guildConfig");
const logger = require("../utils/logger");
const mongoReady = () => mongoose.connection.readyState === 1;

async function handleVoiceState(oldState, newState) {
  try {
    const guild = newState.guild || oldState.guild; if (!guild || newState.member.user.bot || !mongoReady()) return;
    const config = await getGuildConfig(guild.id); if (!config.temp_voice_enabled || !config.temp_voice_creator_channel_id || !config.temp_voice_category) return;
    if (newState.channelId === config.temp_voice_creator_channel_id) await createTemporaryVoice(newState.member, guild, config);
    if (oldState.channelId) await removeIfEmpty(guild, oldState.channelId, config);
  } catch (error) { logger.error("Temporary voice event failed:", error.message); }
}
async function createTemporaryVoice(member, guild, config) {
  const existing = await TemporaryVoice.findOne({ guildId: guild.id, ownerId: member.id });
  if (existing) { const channel = guild.channels.cache.get(existing.channelId); if (channel) return member.voice.setChannel(channel).catch(() => {}); await existing.deleteOne(); }
  const category = guild.channels.cache.get(config.temp_voice_category); if (!category || category.type !== ChannelType.GuildCategory) return;
  const channel = await guild.channels.create({ name: `${member.displayName} · Vocal`, type: ChannelType.GuildVoice, parent: category.id, permissionOverwrites: [{ id: guild.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.Connect] }, { id: member.id, allow: [PermissionsBitField.Flags.ManageChannels, PermissionsBitField.Flags.MoveMembers] }] });
  await TemporaryVoice.create({ guildId: guild.id, channelId: channel.id, ownerId: member.id, categoryId: category.id });
  await member.voice.setChannel(channel).catch((error) => logger.warn(`Temporary voice move failed: ${error.message}`));
  await sendLog(guild, config, "log_moderation_channel_id", { title: "🎙 Vocal temporaire créé", color: "success", target: `${member.user} (${member.id})`, fields: [{ name: "Salon", value: `${channel}` }] });
}
async function removeIfEmpty(guild, channelId, config) {
  const record = await TemporaryVoice.findOne({ channelId }); if (!record) return;
  const channel = guild.channels.cache.get(channelId); if (channel?.members?.size) return;
  try { if (channel) await channel.delete("Vocal temporaire vide"); await record.deleteOne(); await sendLog(guild, config, "log_moderation_channel_id", { title: "🎙 Vocal temporaire supprimé", color: "info", fields: [{ name: "Salon", value: channel?.name || channelId }] }); } catch (error) { logger.error(`Temporary voice cleanup failed: ${error.message}`); }
}
async function cleanupGuild(client) { if (!mongoReady()) return; for (const record of await TemporaryVoice.find().lean()) { const guild = client.guilds.cache.get(record.guildId); if (!guild) continue; const config = await getGuildConfig(guild.id); await removeIfEmpty(guild, record.channelId, config); } }
module.exports = { handleVoiceState, cleanupGuild };
