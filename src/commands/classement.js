const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { getLeaderboard } = require("../services/xpService");
const { getGuildConfig } = require("../services/guildConfig");
module.exports = {
  data: new SlashCommandBuilder().setName("classement").setDescription("Voir le classement XP du serveur"),
  async execute(interaction) {
    const config = await getGuildConfig(interaction.guild.id);
    if (!config.xp_enabled) return interaction.reply({ content: "❌ Le système XP est désactivé.", ephemeral: true });
    const ranking = await getLeaderboard(interaction.guild.id, 10);
    const lines = ranking.length ? ranking.map((entry, index) => `**${index + 1}.** <@${entry.userId}> — niveau ${entry.level} · ${entry.xp} XP`).join("\n") : "Aucune donnée XP pour le moment.";
    return interaction.reply({ embeds: [new EmbedBuilder().setColor("#ffe600").setTitle("🏆 Classement XP").setDescription(lines).setTimestamp()] });
  },
};
