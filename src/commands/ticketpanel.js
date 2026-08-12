const { SlashCommandBuilder, PermissionsBitField } = require("discord.js");
const { TicketPanelService } = require("../modules/tickets/services/TicketPanelService");
const { TicketPanelDeliveryService } = require("../modules/tickets/services/TicketPanelDeliveryService");
const { DiscordTicketTransport } = require("../adapters/discord/DiscordTicketTransport");
const { getTicketPanelRuntime } = require("../modules/tickets/runtime/getTicketPanelRuntime");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("ticketpanel")
    .setDescription("Envoyer le panel ticket")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild),

  async execute(interaction) {
    // Phase 10.2 : injection du resolver Premium via le runtime partagé (même
    // câblage que la composition /settings). Sans entitlement actif, le
    // panneau envoyé reste le panneau Free historique.
    const { configService, premiumConfigResolver } = getTicketPanelRuntime();
    const delivery = new TicketPanelDeliveryService({
      panelService: new TicketPanelService({ configService, premiumConfigResolver }),
      transport: new DiscordTicketTransport({ guild: interaction.guild }),
    });
    // P12.2 (B1) : le panneau part dans le salon de l'interaction — le salon
    // texte où l'admin lance /ticketpanel (comportement standard des bots de
    // tickets). Jamais vers une catégorie.
    const result = await delivery.deliver(interaction.guild.id, (key) => key, interaction.channel?.id ?? null);
    return interaction.reply({
      content: result.delivered
        ? `✅ ${result.channelId}`
        : `❌ ${result.code}`,
      ephemeral: true,
    });
  },
};
