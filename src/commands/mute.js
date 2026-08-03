const { SlashCommandBuilder, PermissionsBitField } = require("discord.js");
const { getGuildConfig } = require("../services/guildConfig");
const { sendLog } = require("../services/logService");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("mute")
    .setDescription("Mute un membre (timeout)")
    .addUserOption((o) => o.setName("utilisateur").setDescription("Utilisateur").setRequired(true))
    .addIntegerOption((o) => o.setName("duree").setDescription("Durée en minutes (défaut: 10)").setRequired(false))
    .addStringOption((o) => o.setName("raison").setDescription("Raison du mute").setRequired(false))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ModerateMembers),

  async execute(interaction) {
    const user = interaction.options.getUser("utilisateur");
    const duree = interaction.options.getInteger("duree") || 10;
    const raison = interaction.options.getString("raison") || "Aucune raison";

    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) {
      return interaction.reply({ content: "❌ Membre introuvable.", ephemeral: true });
    }

    if (!member.moderatable) {
      return interaction.reply({ content: "❌ Je ne peux pas mute ce membre.", ephemeral: true });
    }

    const durationMs = Math.min(duree * 60 * 1000, 28 * 24 * 60 * 60 * 1000); // Max 28 days

    await member.timeout(durationMs, raison);
    await sendLog(interaction.guild, await getGuildConfig(interaction.guild.id), "log_moderation_channel_id", { title: "⏳ Timeout", color: "warning", target: `${user} (${user.id})`, moderator: interaction.user, fields: [{ name: "Durée", value: `${duree} minute(s)`, inline: true }, { name: "Raison", value: raison, inline: true }] });
    return interaction.reply(
      `🔇 ${user.tag} a été mute pour ${duree} minute(s).\n📝 Raison : ${raison}`
    );
  },
};
