const { SlashCommandBuilder, PermissionsBitField } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("deverrouiller")
    .setDescription("Déverrouiller le salon")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageChannels),

  async execute(interaction) {
    await interaction.channel.permissionOverwrites.edit(interaction.guild.id, {
      SendMessages: null,
    }, { reason: `Déverrouillé par ${interaction.user.tag}` });

    return interaction.reply("🔓 Salon déverrouillé.");
  },
};
