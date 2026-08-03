const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const inviteService = require("../services/inviteService");

module.exports = {
  data: new SlashCommandBuilder().setName("invites").setDescription("Voir les invitations et le classement").addUserOption((option) => option.setName("utilisateur").setDescription("Utilisateur à consulter").setRequired(false)),
  async execute(interaction) {
    const user = interaction.options.getUser("utilisateur") || interaction.user;
    const [stats, leaderboard] = await Promise.all([inviteService.getInviteStats(user.id, interaction.guild.id), inviteService.getLeaderboard(interaction.guild.id, 5)]);
    const ranking = leaderboard.length ? leaderboard.map((entry, index) => `**${index + 1}.** <@${entry.userId}> — ${Math.max(0, entry.current)} nettes`).join("\n") : "Aucune statistique disponible.";
    const fake = stats.fake === null ? "Non disponible" : String(stats.fake);
    return interaction.reply({ embeds: [new EmbedBuilder().setColor("#00d4aa").setTitle("📊 Invitations CIVRAT").setThumbnail(user.displayAvatarURL()).addFields(
      { name: "Utilisateur", value: `${user} (${user.id})` },
      { name: "Invitations totales", value: String(stats.total), inline: true },
      { name: "Invitations valides", value: String(stats.current), inline: true },
      { name: "Départs", value: String(stats.left), inline: true },
      { name: "Invitations fausses", value: fake, inline: true },
      { name: "Invitations nettes", value: String(stats.net), inline: true },
      { name: "Classement", value: ranking },
    ).setFooter({ text: "Les invitations fausses nécessitent une source de données dédiée." }).setTimestamp()] });
  },
};
