"use strict";

const { InteractionKind } = require("../../core/interactions");
const { createDiscordMemberCapability } = require("./DiscordMemberCapability");
const { DiscordResponseTransport } = require("./DiscordResponseTransport");
const { toCivratError } = require("./discordErrorClassifier");

class DiscordInteractionAdapter {
  constructor({ router, registry }) {
    this.router = router;
    this.registry = registry;
  }

  async tryHandle(interaction) {
    const envelope = this.normalize(interaction);
    if (!envelope || !this.registry.find(envelope)) return false;
    await this.router.handle(envelope);
    return true;
  }

  normalize(interaction) {
    const kind = interaction.isChatInputCommand?.()
      ? InteractionKind.COMMAND
      : interaction.isAutocomplete?.()
        ? InteractionKind.AUTOCOMPLETE
        : interaction.isButton?.()
          ? InteractionKind.BUTTON
          : this.isSelectMenu(interaction)
            ? InteractionKind.SELECT_MENU
            : interaction.isModalSubmit?.()
              ? InteractionKind.MODAL
              : null;
    if (!kind) return null;

    const transport = new DiscordResponseTransport(interaction);
    return {
      kind,
      name: interaction.commandName || null,
      customId: interaction.customId || null,
      options: interaction.options || null,
      values: interaction.values || [],
      modalValues: kind === InteractionKind.MODAL
        ? Object.fromEntries(interaction.fields?.fields?.map((field) => [field.customId, field.value]) || [])
        : {},
      guildId: interaction.guildId || null,
      channelId: interaction.channelId || interaction.channel?.id || null,
      userId: interaction.user?.id || null,
      locale: interaction.locale || interaction.guildLocale || interaction.guild?.preferredLocale || null,
      member: createDiscordMemberCapability(interaction.member, interaction.guild?.ownerId),
      discordMember: interaction.member,
      discordChannel: interaction.channel,
      discordClient: interaction.client,
      transport,
      mapError: (error, metadata = {}) => toCivratError(error, metadata),
    };
  }

  isSelectMenu(interaction) {
    return Boolean(
      interaction.isAnySelectMenu?.()
      || interaction.isStringSelectMenu?.()
      || interaction.isChannelSelectMenu?.()
      || interaction.isRoleSelectMenu?.()
      || interaction.isUserSelectMenu?.()
      || interaction.isMentionableSelectMenu?.()
    );
  }
}

module.exports = { DiscordInteractionAdapter };
