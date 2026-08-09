const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  PermissionsBitField,
} = require("discord.js");
const { getGuildConfig } = require("../services/guildConfig");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("ticketpanel")
    .setDescription("Envoyer le panel ticket")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  async execute(interaction) {
    const config = await getGuildConfig(interaction.guild.id);
    if (!config.tickets_enabled) {
      return interaction.reply({ content: "❌ Le système de tickets est désactivé dans la configuration du serveur.", ephemeral: true });
    }
    if (!config.ticket_category_id || !config.ticket_support_role_id) {
      return interaction.reply({ content: "❌ Configurez une catégorie et un rôle support avant d’envoyer le panel.", ephemeral: true });
    }

    const embed = new EmbedBuilder()
      .setTitle(config.ticket_panel_title || "🎫 Système de Tickets")
      .setDescription(
        config.ticket_panel_description ||
          `
Besoin d'aide ? Créez un ticket !
Sélectionnez la catégorie correspondant à votre demande.

💬 **Discord** - Plainte, Partenariat, Haut-Staff, Autre
🎮 **In-Game** - Plainte, Freekill, Rec, Haut-Staff, Autre

⚠️ Un seul ticket à la fois par personne
📝 Soyez précis, clair et respectueux`
      )
      .setColor(config.ticket_panel_color || "#5865F2")
      .setImage("https://i.imgur.com/XNrn6N7.png");

    const menu = new StringSelectMenuBuilder()
      .setCustomId("ticket_create")
      .setPlaceholder("Sélectionnez le type de ticket...")
      .addOptions([
        {
          label: "Mon ticket concerne le jeu",
          value: "game",
          description: "Support In-Game",
          emoji: "🎮",
        },
        {
          label: "Mon ticket concerne Discord",
          value: "discord",
          description: "Support Discord",
          emoji: "💬",
        },
      ]);

    const row = new ActionRowBuilder().addComponents(menu);

    await interaction.reply({ content: "✅ Panel envoyé !", ephemeral: true });
    await interaction.channel.send({ embeds: [embed], components: [row] });
  },
};
