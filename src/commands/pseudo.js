const { SlashCommandBuilder, PermissionsBitField } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("pseudo")
    .setDescription("Changer le pseudo d'un membre")
    .addUserOption((o) => o.setName("utilisateur").setDescription("Utilisateur").setRequired(true))
    .addStringOption((o) => o.setName("pseudo").setDescription("Nouveau pseudo").setRequired(true))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageNicknames),

  async execute(interaction) {
    const user = interaction.options.getUser("utilisateur");
    const pseudo = interaction.options.getString("pseudo");

    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) {
      return interaction.reply({ content: "❌ Membre introuvable.", ephemeral: true });
    }

    if (!member.manageable) {
      return interaction.reply({ content: "❌ Je ne peux pas changer le pseudo de ce membre.", ephemeral: true });
    }

    await member.setNickname(pseudo, `Par ${interaction.user.tag}`);
    return interaction.reply(`📝 Pseudo de ${user.tag} changé en **${pseudo}**.`);
  },
};
