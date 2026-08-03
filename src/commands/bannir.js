const { SlashCommandBuilder, PermissionsBitField } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("bannir")
    .setDescription("Bannir un membre")
    .addUserOption((o) => o.setName("utilisateur").setDescription("Membre à bannir").setRequired(true))
    .addStringOption((o) => o.setName("raison").setDescription("Raison du bannissement").setRequired(false))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  async execute(interaction) {
    const user = interaction.options.getUser("utilisateur");
    const raison = interaction.options.getString("raison") || "Aucune raison";

    if (user.id === interaction.user.id) {
      return interaction.reply({ content: "❌ Vous ne pouvez pas vous bannir vous-même.", ephemeral: true });
    }

    const member = await interaction.guild.members.fetch(user.id).catch(() => null);

    if (!member) {
      try {
        await interaction.guild.members.ban(user.id, { reason: raison });
        return interaction.reply(`🔨 ${user.tag} a été banni.\n📝 Raison : ${raison}`);
      } catch {
        return interaction.reply({ content: "❌ Impossible de bannir cet utilisateur.", ephemeral: true });
      }
    }

    if (!member.bannable) {
      return interaction.reply({ content: "❌ Je ne peux pas bannir ce membre.", ephemeral: true });
    }

    if (member.roles.highest.position >= interaction.member.roles.highest.position) {
      return interaction.reply({ content: "❌ Ce membre a un rôle égal ou supérieur au vôtre.", ephemeral: true });
    }

    await member.ban({ reason: raison });
    return interaction.reply(`🔨 ${user.tag} a été banni.\n📝 Raison : ${raison}`);
  },
};
