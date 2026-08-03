const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { getProfile, getRank, xpForNextLevel } = require("../services/xpService");
const { getGuildConfig } = require("../services/guildConfig");

module.exports = {
  data: new SlashCommandBuilder().setName("niveau").setDescription("Voir le niveau d’un membre").addUserOption((option) => option.setName("utilisateur").setDescription("Membre à consulter").setRequired(false)),
  async execute(interaction) {
    const config = await getGuildConfig(interaction.guild.id);
    if (!config.xp_enabled) return interaction.reply({ content: "❌ Le système XP est désactivé.", ephemeral: true });
    const user = interaction.options.getUser("utilisateur") || interaction.user;
    const profile = await getProfile(interaction.guild.id, user.id);
    if (!profile) return interaction.reply({ content: `${user} n’a pas encore gagné d’XP.`, ephemeral: true });
    const next = xpForNextLevel(profile.level);
    const rank = await getRank(interaction.guild.id, user.id, profile.xp);
    return interaction.reply({ embeds: [new EmbedBuilder().setColor("#39ff14").setTitle(`📈 Niveau de ${user.username}`).setThumbnail(user.displayAvatarURL()).addFields(
      { name: "Niveau", value: String(profile.level), inline: true }, { name: "XP", value: `${profile.xp} / ${next}`, inline: true }, { name: "Classement", value: rank ? `#${rank}` : "Indisponible", inline: true }, { name: "Messages comptés", value: String(profile.totalMessages), inline: true },
    ).setTimestamp()] });
  },
};
