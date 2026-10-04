"use strict";

const { PermissionName } = require("../../core/permissions");
const { StickerService } = require("./services/StickerService");
const { DiscordStickerTransport } = require("../../adapters/discord/DiscordStickerTransport");

/** Code de refus → clé i18n. Le fallback `sticker.uploadFailed` conserve le
 *  comportement générique des erreurs réellement venues de Discord
 *  (`countStickers` / `createSticker` / API). */
const ERROR_MESSAGE_KEY = Object.freeze({
  STICKER_LIMIT_REACHED: "sticker.limitReached",
  STICKER_MISSING_FILE: "sticker.missingFile",
  STICKER_INVALID_NAME: "sticker.invalidName",
  STICKER_FETCH_FAILED: "sticker.fetchFailed",
  STICKER_UNSUPPORTED_FORMAT: "sticker.unsupportedFormat",
  STICKER_INVALID_SIZE: "sticker.invalidSize",
  STICKER_TOO_LARGE: "sticker.tooLarge",
  STICKER_RATE_LIMITED: "ratelimit.retry",
});

function registerSticker({ registry }) {
  const command = {
    name: "uploadsticker",
    description: "Upload a sticker (Free limit 5)",
    permissions: { allOf: [PermissionName.MANAGE_GUILD] },
    options: [
      { type: "string", name: "name", description: "Sticker name (2-30)", required: true },
      { type: "attachment", name: "file", description: "Sticker file (png/apng/gif/lottie json)", required: true },
      { type: "string", name: "description", description: "Description", required: false },
      { type: "string", name: "tags", description: "Tags", required: false },
    ],
    execute: async (context) => {
      const name = context.envelope.options.getString("name");
      const file = context.envelope.options.getAttachment("file");
      const description = context.envelope.options.getString("description");
      const tags = context.envelope.options.getString("tags");
      const guild = context.envelope.discordMember.guild;
      const transport = new DiscordStickerTransport({ guild });
      const service = new StickerService();
      const result = await service.upload({
        file,
        name,
        description,
        tags,
        transport,
        guildId: context.guildId ?? null,
        userId: context.userId ?? null,
        attachmentSizeLimit: context.envelope?.attachmentSizeLimit ?? null,
        rateLimitGuard: context.rateLimitGuard ?? null,
      });
      if (result.ok) {
        await context.envelope.transport.reply({ view: { title: context.t("sticker.uploadSuccess", { name: result.sticker?.name || name }), content: "", components: [] }, ephemeral: true });
      } else {
        const key = ERROR_MESSAGE_KEY[result.code] || "sticker.uploadFailed";
        const vars = result.details || {};
        await context.envelope.transport.reply({ view: { title: context.t(key, vars), content: "", components: [] }, ephemeral: true });
      }
      return result;
    },
  };
  registry.registerCommand(command);
  return { commands: [command] };
}

module.exports = { registerSticker };
