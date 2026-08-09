const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionsBitField } = require("discord.js");
const { supabase, mongoose } = require("../config/database");
const GiveawayEntry = require("../models/GiveawayEntry");
const { sendLog } = require("./logService");
const guildConfigService = require("./guildConfig");
const logger = require("../utils/logger");

function mongoReady() { return mongoose.connection.readyState === 1; }
function joinButton(id) { return new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`giveaway_join:${id}`).setLabel("Participer").setEmoji("🎉").setStyle(ButtonStyle.Primary)); }
function giveawayEmbed(giveaway) { return new EmbedBuilder().setColor("#ffe600").setTitle(`🎉 ${giveaway.title}`).setDescription(giveaway.description || "Cliquez sur le bouton pour participer.").addFields({ name: "Gagnants", value: String(giveaway.winners_count), inline: true }, { name: "Fin", value: `<t:${Math.floor(new Date(giveaway.ends_at).getTime() / 1000)}:R>`, inline: true }).setTimestamp(); }

async function createGiveaway(guild, config, { title, description = "", channelId, durationHours, winnersCount, requirements = "" }, actor) {
  if (!supabase || !config.giveaways_enabled) throw new Error("Giveaways disabled or Supabase unavailable");
  const channel = guild.channels.cache.get(channelId);
  if (!channel?.isTextBased?.() || !guild.members.me || !channel.permissionsFor(guild.members.me)?.has(PermissionsBitField.Flags.SendMessages)) throw new Error("Configured giveaway channel is unavailable");
  const endsAt = new Date(Date.now() + durationHours * 3_600_000).toISOString();
  const { data, error } = await supabase.from("giveaways").insert({ guild_id: guild.id, title, description, channel_id: channelId, duration: durationHours * 3600, winners_count: winnersCount, requirements, active: true, status: "active", ends_at: endsAt }).select().single();
  if (error) throw error;
  await channel.send({ embeds: [giveawayEmbed(data)], components: [joinButton(data.id)] });
  await sendLog(guild, config, "log_moderation_channel_id", { title: "🎉 Giveaway créé", color: "success", moderator: actor, fields: [{ name: "Lot", value: title }, { name: "Fin", value: `<t:${Math.floor(new Date(endsAt).getTime() / 1000)}:R>`, inline: true }] });
  return data;
}

async function joinGiveaway(interaction, giveawayId) {
  if (!mongoReady()) return interaction.reply({ content: "❌ Les participations sont temporairement indisponibles.", ephemeral: true });
  const { data: giveaway, error } = await supabase.from("giveaways").select("*").eq("id", giveawayId).eq("guild_id", interaction.guild.id).maybeSingle();
  if (error || !giveaway || !giveaway.active || new Date(giveaway.ends_at) <= new Date()) return interaction.reply({ content: "❌ Ce giveaway est terminé ou introuvable.", ephemeral: true });
  try { await GiveawayEntry.create({ giveawayId: giveaway.id, guildId: interaction.guild.id, userId: interaction.user.id }); return interaction.reply({ content: "✅ Participation enregistrée.", ephemeral: true }); }
  catch (error) { if (error?.code === 11000) return interaction.reply({ content: "ℹ️ Vous participez déjà à ce giveaway.", ephemeral: true }); logger.error("Giveaway entry failed:", error.message); return interaction.reply({ content: "❌ Impossible d’enregistrer la participation.", ephemeral: true }); }
}

async function finishGiveaway(guild, giveaway, actor, reroll = false) {
  if (!mongoReady()) throw new Error("MongoDB unavailable");
  const entries = await GiveawayEntry.find({ giveawayId: giveaway.id }).lean();
  const unique = [...new Set(entries.map((entry) => entry.userId))];
  const winners = unique.sort(() => Math.random() - 0.5).slice(0, Math.min(giveaway.winners_count, unique.length));
  const channel = guild.channels.cache.get(giveaway.channel_id);
  if (channel?.isTextBased?.()) await channel.send({ content: winners.length ? `🎉 Giveaway **${giveaway.title}** terminé ! Gagnant${winners.length > 1 ? "s" : ""} : ${winners.map((id) => `<@${id}>`).join(", ")}` : `🎉 Giveaway **${giveaway.title}** terminé sans participant.` });
  const config = await guildConfigService.getGuildConfig(guild.id);
  await sendLog(guild, config, "log_moderation_channel_id", { title: reroll ? "🎲 Giveaway reroll" : "🏁 Giveaway terminé", color: "success", moderator: actor, fields: [{ name: "Lot", value: giveaway.title }, { name: "Participants", value: String(unique.length), inline: true }, { name: "Gagnants", value: winners.length ? winners.map((id) => `<@${id}>`).join(", ") : "Aucun" }] });
  if (!reroll) { const { error } = await supabase.from("giveaways").update({ active: false, status: "ended", ended_at: new Date().toISOString() }).eq("id", giveaway.id); if (error) throw error; }
  return winners;
}

async function endDueGiveaways(client) {
  if (!supabase || !mongoReady()) return;
  try {
    const { data, error } = await supabase.from("giveaways").select("*").eq("active", true).lte("ends_at", new Date().toISOString());
    if (error) throw error;
    for (const giveaway of data || []) { const guild = client.guilds.cache.get(giveaway.guild_id); if (guild) await finishGiveaway(guild, giveaway, client.user); }
  } catch (error) { logger.error("Giveaway scheduler failed:", error.message); }
}

module.exports = { createGiveaway, joinGiveaway, finishGiveaway, endDueGiveaways };
