const { SlashCommandBuilder, PermissionsBitField } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("supprimer")
    .setDescription("Supprimer des messages en masse")
    .addIntegerOption((o) =>
      o.setName("nombre").setDescription("Nombre de messages (1-100)").setRequired(true).setMinValue(1).setMaxValue(100)
    )
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageMessages),

  async execute(interaction) {
    const nombre = interaction.options.getInteger("nombre");

    try {
      const deleted = await interaction.channel.bulkDelete(nombre, true);
      return interaction.reply({
        content: `✅ ${deleted.size} message(s) supprimé(s).`,
        ephemeral: true,
      });
    } catch {
      return interaction.reply({
        content: "❌ Impossible de supprimer. Les messages de plus de 14 jours ne peuvent pas être supprimés en masse.",
        ephemeral: true,
      });
    }
  },
};
