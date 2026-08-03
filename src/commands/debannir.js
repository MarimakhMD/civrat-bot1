const { SlashCommandBuilder, PermissionsBitField } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("debannir")
    .setDescription("Débannir un membre")
    .addStringOption((o) => o.setName("id").setDescription("ID utilisateur").setRequired(true))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  async execute(interaction) {
    const userId = interaction.options.getString("id");

    try {
      const ban = await interaction.guild.bans.fetch(userId).catch(() => null);
      if (!ban) {
        return interaction.reply({ content: "❌ Cet utilisateur n'est pas banni.", ephemeral: true });
      }

      await interaction.guild.members.unban(userId);
      return interaction.reply(`🔓 <@${userId}> a été débanni.`);
    } catch {
      return interaction.reply({ content: "❌ Impossible de débannir cet utilisateur.", ephemeral: true });
    }
  },
};
