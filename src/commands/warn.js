const { SlashCommandBuilder, PermissionsBitField, EmbedBuilder } = require("discord.js");
const { getGuildConfig } = require("../services/guildConfig");
const { getLogsRuntime } = require("../modules/logs/runtime/getLogsRuntime");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Avertir un membre")
    .addUserOption((o) => o.setName("utilisateur").setDescription("Utilisateur").setRequired(true))
    .addStringOption((o) => o.setName("raison").setDescription("Raison de l'avertissement").setRequired(false))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ModerateMembers),

  async execute(interaction) {
    const user = interaction.options.getUser("utilisateur");
    const raison = interaction.options.getString("raison") || "Aucune raison";

    if (user.bot) {
      return interaction.reply({ content: "❌ Impossible d'avertir un bot.", ephemeral: true });
    }

    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) {
      return interaction.reply({ content: "❌ Membre introuvable.", ephemeral: true });
    }

    // DM the user
    try {
      await user.send(
        `⚠️ Vous avez reçu un avertissement sur **${interaction.guild.name}**\n📝 Raison : ${raison}\n🛡 Par : ${interaction.user.tag}`
      );
    } catch {
      // User has DMs disabled
    }

    const embed = new EmbedBuilder()
      .setColor("#FAA61A")
      .setTitle("⚠️ Avertissement")
      .setDescription(
        `👤 **Membre :** ${user}\n📝 **Raison :** ${raison}\n🛡 **Par :** ${interaction.user}`
      )
      .setTimestamp();

    await getLogsRuntime().handleModerationEvent({
      guild: interaction.guild,
      action: "member_warned",
      targetId: user.id,
    });
    return interaction.reply({ embeds: [embed] });
  },
};
