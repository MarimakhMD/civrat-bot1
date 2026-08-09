const { SlashCommandBuilder, PermissionsBitField } = require("discord.js");
const { getGuildConfig } = require("../services/guildConfig");
const { buildWelcomePreview } = require("../services/welcomeService");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("testwelcome")
    .setDescription("Prévisualiser le message de bienvenue")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild),
  async execute(interaction) {
    const config = await getGuildConfig(interaction.guild.id);
    if (!config.welcome_enabled) {
      return interaction.reply({ content: "❌ Welcome est désactivé dans la configuration du serveur.", ephemeral: true });
    }
    return interaction.reply({ ...buildWelcomePreview(interaction.member, config), ephemeral: true });
  },
};
