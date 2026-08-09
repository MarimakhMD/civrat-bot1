const { SlashCommandBuilder, PermissionsBitField } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("expulser")
    .setDescription("Expulser un membre")
    .addUserOption((o) => o.setName("utilisateur").setDescription("Membre à expulser").setRequired(true))
    .addStringOption((o) => o.setName("raison").setDescription("Raison de l'expulsion").setRequired(false))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  async execute(interaction) {
    const user = interaction.options.getUser("utilisateur");
    const raison = interaction.options.getString("raison") || "Aucune raison";

    if (user.id === interaction.user.id) {
      return interaction.reply({ content: "❌ Vous ne pouvez pas vous expulser.", ephemeral: true });
    }

    const member = await interaction.guild.members.fetch(user.id).catch(() => null);

    if (!member) {
      return interaction.reply({ content: "❌ Membre introuvable.", ephemeral: true });
    }

    if (!member.kickable) {
      return interaction.reply({ content: "❌ Je ne peux pas expulser ce membre.", ephemeral: true });
    }

    if (member.roles.highest.position >= interaction.member.roles.highest.position) {
      return interaction.reply({ content: "❌ Ce membre a un rôle égal ou supérieur au vôtre.", ephemeral: true });
    }

    await member.kick(raison);
    return interaction.reply(`👢 ${user.tag} a été expulsé.\n📝 Raison : ${raison}`);
  },
};
