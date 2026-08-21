const { SlashCommandBuilder, PermissionsBitField, InteractionContextType } = require("discord.js");
const { CaptchaConfigService } = require("../modules/captcha/services/CaptchaConfigService");
const { CaptchaPanelService } = require("../modules/captcha/services/CaptchaPanelService");
const { CaptchaPanelDeliveryService } = require("../modules/captcha/services/CaptchaPanelDeliveryService");
const { DiscordCaptchaTransport } = require("../adapters/discord/DiscordCaptchaTransport");
const { I18nService, resolveGuildLocale } = require("../core/i18n");
const captchaFr = require("../modules/captcha/translations/fr.json");
const captchaEn = require("../modules/captcha/translations/en.json");
const guildConfigService = require("../services/guildConfig");

// Traducteur localisé pour la commande autonome /captcha (le panneau envoyé
// doit montrer du vrai texte FR/EN, pas des clés de traduction brutes).
const captchaI18n = new I18nService({ dictionaries: { en: captchaEn, fr: captchaFr } });

module.exports = {
  data: new SlashCommandBuilder()
    .setName("captcha")
    .setDescription("Gérer le panneau de vérification")
    // V1 — exposition : /captcha est strictement serveur (Guild-only).
    .setContexts([InteractionContextType.Guild])
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild)
    .addSubcommand((sub) => sub.setName("panel").setDescription("Envoyer le panneau de vérification")),
  async execute(interaction) {
    // Déferrement immédiat : l'envoi du panel fait de l'I/O Discord.
    await interaction.deferReply({ ephemeral: true }).catch(() => {});

    const t = captchaI18n.forLocale(resolveGuildLocale(interaction.locale || interaction.guild?.preferredLocale));

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

    let result;
    try {
      result = await delivery.deliver(interaction.guild.id, t);
    } catch (error) {
      return interaction.editReply({
        content: `❌ ${error?.message || "captcha.channelMissing"}`,
      });
    }

    const content = result.delivered
      ? `✅ ${t("captcha.panelSent", { channel: `<#${result.channelId}>` })}`
      : `❌ ${t(result.reason)}`;
    return interaction.editReply({ content });
  },
};
