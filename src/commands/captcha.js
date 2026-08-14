const { SlashCommandBuilder, PermissionsBitField, InteractionContextType } = require("discord.js");
const { CaptchaConfigService } = require("../modules/captcha/services/CaptchaConfigService");
const { CaptchaPanelService } = require("../modules/captcha/services/CaptchaPanelService");
const { CaptchaPanelDeliveryService } = require("../modules/captcha/services/CaptchaPanelDeliveryService");
const { DiscordCaptchaTransport } = require("../adapters/discord/DiscordCaptchaTransport");
const guildConfigService = require("../services/guildConfig");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("captcha")
    .setDescription("Gérer le panneau de vérification")
    // V1 — exposition : /captcha est strictement serveur (Guild-only).
    .setContexts([InteractionContextType.Guild])
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild)
    .addSubcommand((sub) => sub.setName("panel").setDescription("Envoyer le panneau de vérification")),
  async execute(interaction) {
    const configService = new CaptchaConfigService({
      guildConfigResolver: {
        get: guildConfigService.getGuildConfig,
        update: guildConfigService.updateGuildConfig,
      },
    });
    const delivery = new CaptchaPanelDeliveryService({
      panelService: new CaptchaPanelService({ configService }),
      transport: new DiscordCaptchaTransport({ guild: interaction.guild }),
    });
    const result = await delivery.deliver(interaction.guild.id, (key) => key);
    return interaction.reply({
      content: result.delivered
        ? `✅ Panneau de vérification envoyé dans <#${result.channelId}>.`
        : `❌ ${result.reason}`,
      ephemeral: true,
    });
  },
};
