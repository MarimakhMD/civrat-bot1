const { SlashCommandBuilder, PermissionsBitField, InteractionContextType } = require("discord.js");
const { TicketPanelService } = require("../modules/tickets/services/TicketPanelService");
const { TicketPanelDeliveryService } = require("../modules/tickets/services/TicketPanelDeliveryService");
const { DiscordTicketTransport } = require("../adapters/discord/DiscordTicketTransport");
const { getTicketPanelRuntime } = require("../modules/tickets/runtime/getTicketPanelRuntime");
// M8 — chaîne de résolution Supabase (durable) > InMemory (dégradé).
const { getTicketPanelRepository } = require("../modules/tickets/runtime/getTicketPanelRepository");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("ticketpanel")
    .setDescription("Envoyer le panel ticket")
    // V1 — exposition : /ticketpanel est strictement serveur (Guild-only).
    .setContexts([InteractionContextType.Guild])
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild),

  /**
   * M8 — /ticketpanel crée désormais un panel PERSISTANT dans
   * public.ticket_panels, au lieu d'envoyer un message sans identité.
   *
   * Décision D-C : sans argument, la commande publie un panel PAR DÉFAUT à un
   * bouton, dérivé de la configuration actuelle de la guilde. Le comportement
   * visible pour un admin qui utilisait déjà la commande est donc préservé ; ce
   * qui change, c'est que le panel est désormais retrouvé après redémarrage,
   * éditable, désactivable, et que son bouton identifie son origine.
   *
   * Aucune option slash n'a été ajoutée (décision validée) : la personnalisation
   * fine — plusieurs boutons, catégorie et rôle par bouton — passe par la
   * sous-vue Panels de /settings.
   */
  async execute(interaction) {
    const { configService, premiumConfigResolver, i18n } = getTicketPanelRuntime();
    const panelService = new TicketPanelService({ configService, premiumConfigResolver });
    const config = await configService.read(interaction.guild.id);
    const t = i18n.forLocale(config?.language);
    const panelRepository = getTicketPanelRepository();
    const transport = new DiscordTicketTransport({ guild: interaction.guild });
    const delivery = new TicketPanelDeliveryService({ panelService, transport, panelRepository });

    // P12.2 (B1) inchangé : le panel part dans le salon de l'interaction — le
    // salon texte où l'admin lance /ticketpanel. Jamais vers une catégorie.
    const draft = await panelService.defaultDraft({ guildId: interaction.guild.id, t });
    const result = await delivery.deliver({
      guildId: interaction.guild.id,
      t,
      channelId: interaction.channel?.id ?? null,
      draft,
    });

    return interaction.reply({
      content: result.delivered
        ? t("tickets.panelCreated", { channel: `<#${result.channelId}>`, id: result.panelId })
        : t(`tickets.${result.code}`),
      ephemeral: true,
    });
  },
};
