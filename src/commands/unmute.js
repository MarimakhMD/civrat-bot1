const { SlashCommandBuilder, PermissionsBitField } = require("discord.js");
const { getGuildConfig } = require("../services/guildConfig");
const { sendLog } = require("../services/logService");

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
    await sendLog(interaction.guild, await getGuildConfig(interaction.guild.id), "log_moderation_channel_id", { title: "✅ Timeout retiré", color: "success", target: `${user} (${user.id})`, moderator: interaction.user });
    return interaction.reply(`🔊 ${user.tag} a été unmute.`);
  },
};
