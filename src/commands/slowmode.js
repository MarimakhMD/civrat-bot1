const { SlashCommandBuilder, PermissionsBitField } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("slowmode")
    .setDescription("Activer le slowmode dans le salon")
    .addIntegerOption((o) =>
      o.setName("temps").setDescription("Secondes entre chaque message (0 pour désactiver)").setRequired(true).setMinValue(0).setMaxValue(21600)
    )
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageChannels),

  async execute(interaction) {
    const temps = interaction.options.getInteger("temps");

    await interaction.channel.setRateLimitPerUser(temps, `Slowmode par ${interaction.user.tag}`);

    if (temps === 0) {
      return interaction.reply("🔓 Slowmode désactivé.");
    }
    return interaction.reply(`🐌 Slowmode activé : ${temps} seconde(s) entre chaque message.`);
  },
};
