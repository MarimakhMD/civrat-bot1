"use strict";

const commandHandler = require("../handlers/commandHandler");
const logger = require("../utils/logger");
const { ErrorResponder } = require("../core/errors");
const { I18nService, dictionaries } = require("../core/i18n");
const {
  DiscordResponseTransport,
  toCivratError,
} = require("../adapters/discord");
const { getGuildSettingsRuntime } = require("../runtime/getGuildSettingsRuntime");

const errorResponder = new ErrorResponder({ logger });
const i18n = new I18nService({ dictionaries });

module.exports = {
  name: "interactionCreate",
  async execute(interaction) {
    try {
      const handled = await getGuildSettingsRuntime().tryHandle(interaction);
      if (handled) return;
      if (interaction.isChatInputCommand?.()) return commandHandler.handleCommand(interaction);
    } catch (error) {
      const mapped = toCivratError(error, { operation: "interaction_event", resource: "discord_interaction" });
      const locale = interaction.locale || interaction.guildLocale || interaction.guild?.preferredLocale || "fr";
      await errorResponder.respond({
        error: mapped,
        context: {
          guildId: interaction.guildId || null,
          channelId: interaction.channelId || interaction.channel?.id || null,
          userId: interaction.user?.id || null,
          t: i18n.forLocale(locale),
        },
        transport: new DiscordResponseTransport(interaction),
      });
    }
  },
};
