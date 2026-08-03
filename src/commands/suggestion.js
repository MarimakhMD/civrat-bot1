const { SlashCommandBuilder, PermissionsBitField } = require("discord.js");
const { getGuildConfig } = require("../services/guildConfig");
const service = require("../services/suggestionService");
const { supabase } = require("../config/database");
const { sendLog } = require("../services/logService");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("suggestion")
    .setDescription("Gérer les suggestions")
    .addSubcommand((sub) => sub.setName("proposer").setDescription("Proposer une idée")
      .addStringOption((option) => option.setName("texte").setDescription("Votre suggestion").setRequired(true).setMaxLength(1800)))
    .addSubcommand((sub) => sub.setName("repondre").setDescription("Répondre officiellement")
      .addIntegerOption((option) => option.setName("id").setDescription("ID suggestion").setRequired(true))
      .addStringOption((option) => option.setName("message").setDescription("Réponse staff").setRequired(true).setMaxLength(1800))),
  async execute(interaction) {
    const config = await getGuildConfig(interaction.guild.id);
    const action = interaction.options.getSubcommand();
    if (action === "proposer") {
      try {
        const suggestion = await service.createSuggestion(interaction.guild, config, interaction.user, interaction.options.getString("texte").trim());
        return interaction.reply({ content: `✅ Suggestion #${suggestion.id} publiée.`, ephemeral: true });
      } catch (error) { return interaction.reply({ content: `❌ Suggestion impossible : ${error.message}`, ephemeral: true }); }
    }
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) return interaction.reply({ content: "❌ Action réservée au staff.", ephemeral: true });
    const id = interaction.options.getInteger("id");
    const response = interaction.options.getString("message").trim();
    const { data: suggestion } = await supabase.from("suggestions").update({ staff_response: response }).eq("id", id).eq("guild_id", interaction.guild.id).select().single();
    if (!suggestion) return interaction.reply({ content: "❌ Suggestion introuvable.", ephemeral: true });
    const channel = interaction.guild.channels.cache.get(config.suggestions_approval_channel_id || config.suggestions_channel_id);
    if (channel?.isTextBased?.()) await channel.send({ content: `💬 Réponse officielle à la suggestion #${id}\n${response}` });
    await sendLog(interaction.guild, config, "log_moderation_channel_id", { title: "💡 Réponse suggestion", color: "info", moderator: interaction.user, fields: [{ name: "ID", value: String(id) }, { name: "Réponse", value: response.slice(0, 1000) }] });
    return interaction.reply({ content: "✅ Réponse publiée.", ephemeral: true });
  },
};
