const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("infomembre")
    .setDescription("Voir les infos d'un membre")
    .addUserOption((o) =>
      o.setName("utilisateur").setDescription("Le membre à voir").setRequired(true)
    ),

  async execute(interaction) {
    const user = interaction.options.getUser("utilisateur");
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);

    if (!member) {
      return interaction.reply({ content: "❌ Membre introuvable.", ephemeral: true });
    }

    const roles = member.roles.cache
      .filter((r) => r.id !== interaction.guild.id)
      .sort((a, b) => b.position - a.position)
      .map((r) => r.toString())
      .join(", ") || "Aucun";

    const embed = new EmbedBuilder()
      .setColor(member.displayHexColor || "#5865F2")
      .setTitle(`👤 ${user.tag}`)
      .setThumbnail(user.displayAvatarURL({ size: 256 }))
      .addFields(
        { name: "🆔 ID", value: user.id, inline: true },
        { name: "📅 Compte créé", value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true },
        { name: "📥 A rejoint", value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`, inline: true },
        { name: "🎭 Rôles", value: roles.slice(0, 1024) },
        { name: "🤖 Bot", value: user.bot ? "Oui" : "Non", inline: true }
      )
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  },
};
