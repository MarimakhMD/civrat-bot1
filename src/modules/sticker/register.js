"use strict";

const { PermissionName } = require("../../core/permissions");
const { StickerService } = require("./services/StickerService");
const { DiscordStickerTransport } = require("../../adapters/discord/DiscordStickerTransport");

function registerSticker({ registry }) {
  const command = {
    name: "uploadsticker",
    description: "Upload a sticker (Free limit 5)",
    permissions: { allOf: [PermissionName.MANAGE_GUILD] },
    options: [
      { type: "string", name: "name", description: "Sticker name (2-30)", required: true },
      { type: "attachment", name: "file", description: "Sticker file (png/jpeg/gif)", required: true },
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
      const result = await service.upload({ file, name, description, tags, transport });
      if (result.ok) {
        await context.envelope.transport.reply({ view: { title: context.t("sticker.uploadSuccess", { name: result.sticker?.name || name }), content: "", components: [] }, ephemeral: true });
      } else {
        const key = result.code === "STICKER_LIMIT_REACHED" ? "sticker.limitReached" : result.code === "STICKER_MISSING_FILE" ? "sticker.missingFile" : result.code === "STICKER_INVALID_NAME" ? "sticker.invalidName" : result.code === "STICKER_FETCH_FAILED" ? "sticker.fetchFailed" : "sticker.uploadFailed";
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
