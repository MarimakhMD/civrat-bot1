const { SlashCommandBuilder, PermissionsBitField } = require("discord.js");
const { getGuildConfig } = require("../services/guildConfig");
const giveawayService = require("../services/giveawayService");
const { supabase } = require("../config/database");
const { sendLog } = require("../services/logService");

module.exports = {
  data: new SlashCommandBuilder().setName("giveaway").setDescription("Gérer les giveaways").setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild)
    .addSubcommand((sub) => sub.setName("creer").setDescription("Créer un giveaway").addStringOption((o) => o.setName("lot").setDescription("Lot à gagner").setRequired(true)).addChannelOption((o) => o.setName("salon").setDescription("Salon de publication").setRequired(true)).addIntegerOption((o) => o.setName("duree").setDescription("Durée en heures").setMinValue(1).setMaxValue(720).setRequired(true)).addIntegerOption((o) => o.setName("gagnants").setDescription("Nombre de gagnants").setMinValue(1).setMaxValue(20).setRequired(true)).addStringOption((o) => o.setName("description").setDescription("Description")))
    .addSubcommand((sub) => sub.setName("terminer").setDescription("Terminer un giveaway").addIntegerOption((o) => o.setName("id").setDescription("ID giveaway").setRequired(true)))
    .addSubcommand((sub) => sub.setName("reroll").setDescription("Relancer le tirage").addIntegerOption((o) => o.setName("id").setDescription("ID giveaway").setRequired(true)))
    .addSubcommand((sub) => sub.setName("annuler").setDescription("Annuler un giveaway").addIntegerOption((o) => o.setName("id").setDescription("ID giveaway").setRequired(true))),
  async execute(interaction) {
    const config = await getGuildConfig(interaction.guild.id);
    if (!config.giveaways_enabled) return interaction.reply({ content: "❌ Les giveaways sont désactivés.", ephemeral: true });
    const action = interaction.options.getSubcommand();
    if (action === "creer") {
      try { const giveaway = await giveawayService.createGiveaway(interaction.guild, config, { title: interaction.options.getString("lot"), description: interaction.options.getString("description") || "", channelId: interaction.options.getChannel("salon").id, durationHours: interaction.options.getInteger("duree"), winnersCount: interaction.options.getInteger("gagnants") }, interaction.user); return interaction.reply({ content: `✅ Giveaway créé avec l’ID #${giveaway.id}.`, ephemeral: true }); }
      catch (error) { return interaction.reply({ content: `❌ Création impossible : ${error.message}`, ephemeral: true }); }
    }
    const id = interaction.options.getInteger("id");
    const { data: giveaway } = await supabase.from("giveaways").select("*").eq("id", id).eq("guild_id", interaction.guild.id).maybeSingle();
    if (!giveaway) return interaction.reply({ content: "❌ Giveaway introuvable.", ephemeral: true });
    if (action === "annuler") { await supabase.from("giveaways").update({ active: false, status: "cancelled", ended_at: new Date().toISOString() }).eq("id", giveaway.id); await sendLog(interaction.guild, config, "log_moderation_channel_id", { title: "🚫 Giveaway annulé", color: "warning", moderator: interaction.user, fields: [{ name: "Lot", value: giveaway.title }] }); return interaction.reply({ content: "✅ Giveaway annulé.", ephemeral: true }); }
    try { await giveawayService.finishGiveaway(interaction.guild, giveaway, interaction.user, action === "reroll"); return interaction.reply({ content: `✅ ${action === "reroll" ? "Reroll effectué" : "Giveaway terminé"}.`, ephemeral: true }); }
    catch (error) { return interaction.reply({ content: `❌ Action impossible : ${error.message}`, ephemeral: true }); }
  },
};
