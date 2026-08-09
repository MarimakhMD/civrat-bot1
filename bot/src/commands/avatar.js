const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("avatar")
    .setDescription("Voir l'avatar d'un membre")
    .addUserOption((o) =>
      o.setName("utilisateur").setDescription("Le membre à voir").setRequired(true)
    ),

  async execute(interaction) {
    const user = interaction.options.getUser("utilisateur");
    const embed = new EmbedBuilder()
      .setColor("#5865F2")
      .setTitle(`🖼️ Avatar de ${user.tag}`)
      .setImage(user.displayAvatarURL({ size: 1024 }))
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  },
};
