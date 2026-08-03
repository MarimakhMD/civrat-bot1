const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("infoserveur")
    .setDescription("Voir les infos du serveur"),

  async execute(interaction) {
    const guild = interaction.guild;
    const owner = await guild.fetchOwner();

    const embed = new EmbedBuilder()
      .setColor("#5865F2")
      .setTitle(`📋 ${guild.name}`)
      .setThumbnail(guild.iconURL({ size: 256 }))
      .addFields(
        { name: "👑 Propriétaire", value: `${owner.user.tag}`, inline: true },
        { name: "🆔 ID", value: guild.id, inline: true },
        { name: "📅 Créé le", value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:F>`, inline: true },
        { name: "👥 Membres", value: `${guild.memberCount}`, inline: true },
        { name: "📁 Salons", value: `${guild.channels.cache.size}`, inline: true },
        { name: "🎭 Rôles", value: `${guild.roles.cache.size}`, inline: true },
        { name: "😊 Emojis", value: `${guild.emojis.cache.size}`, inline: true },
        { name: "🚀 Boosts", value: `${guild.premiumSubscriptionCount || 0} (Niveau ${guild.premiumTier})`, inline: true }
      )
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  },
};
