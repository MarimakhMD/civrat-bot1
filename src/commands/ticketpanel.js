const { SlashCommandBuilder, PermissionsBitField } = require("discord.js");
const { TicketConfigService } = require("../modules/tickets/services/TicketConfigService");
const { TicketPanelService } = require("../modules/tickets/services/TicketPanelService");
const { TicketPanelDeliveryService } = require("../modules/tickets/services/TicketPanelDeliveryService");
const { DiscordTicketTransport } = require("../adapters/discord/DiscordTicketTransport");
const guildConfigService = require("../services/guildConfig");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("ticketpanel")
    .setDescription("Envoyer le panel ticket")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild),

  async execute(interaction) {
    const configService = new TicketConfigService({
      guildConfigResolver: {
        get: guildConfigService.getGuildConfig,
        update: guildConfigService.updateGuildConfig,
      },
    });
    const delivery = new TicketPanelDeliveryService({
      panelService: new TicketPanelService({ configService }),
      transport: new DiscordTicketTransport({ guild: interaction.guild }),
    });
    const result = await delivery.deliver(interaction.guild.id, (key) => key);
    return interaction.reply({
      content: result.delivered
        ? `✅ ${result.channelId}`
        : `❌ ${result.code}`,
      ephemeral: true,
    });
  },
};
