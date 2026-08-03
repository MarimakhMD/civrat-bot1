const { SlashCommandBuilder, PermissionsBitField } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("verrouiller")
    .setDescription("Verrouiller le salon (empêche les membres d'envoyer des messages)")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageChannels),

  async execute(interaction) {
    await interaction.channel.permissionOverwrites.edit(interaction.guild.id, {
      SendMessages: false,
    }, { reason: `Verrouillé par ${interaction.user.tag}` });

    return interaction.reply("🔒 Salon verrouillé.");
  },
};
