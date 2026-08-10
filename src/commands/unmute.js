const { SlashCommandBuilder, PermissionsBitField } = require("discord.js");
const { getGuildConfig } = require("../services/guildConfig");
const { getLogsRuntime } = require("../modules/logs/runtime/getLogsRuntime");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("unmute")
    .setDescription("Unmute un membre")
    .addUserOption((o) => o.setName("utilisateur").setDescription("Utilisateur").setRequired(true))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ModerateMembers),

  async execute(interaction) {
    const user = interaction.options.getUser("utilisateur");
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);

    if (!member) {
      return interaction.reply({ content: "❌ Membre introuvable.", ephemeral: true });
    }

    if (!member.isCommunicationDisabled()) {
      return interaction.reply({ content: "❌ Ce membre n'est pas mute.", ephemeral: true });
    }

    await member.timeout(null, "Unmute");
    await getLogsRuntime().handleModerationEvent({
      guild: interaction.guild,
      action: "member_untimeout",
      targetId: user.id,
    });
    return interaction.reply(`🔊 ${user.tag} a été unmute.`);
  },
};
