const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Voir la latence du bot"),

  async execute(interaction) {
    const latency = Date.now() - interaction.createdTimestamp;
    const apiLatency = Math.round(interaction.client.ws.ping);

    const embed = new EmbedBuilder()
      .setColor("#5865F2")
      .setTitle("🏓 Pong !")
      .setDescription(
        `**Latence Bot :** ${latency}ms\n**Latence API :** ${apiLatency}ms`
      )
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  },
};
