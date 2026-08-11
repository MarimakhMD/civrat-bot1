"use strict";

/**
 * Discord transport for sticker upload. Only depends on Discord.js guild API.
 */
class DiscordStickerTransport {
  constructor({ guild }) {
    this.guild = guild;
  }

  async fetchStickers() {
    try {
      const stickers = await this.guild.stickers.fetch();
      return [...stickers.values()];
    } catch {
      return [];
    }
  }

  async countStickers() {
    const stickers = await this.fetchStickers();
    return stickers.length;
  }

  async createSticker({ file, name, description, tags }) {
    // Discord.js: guild.stickers.create({ file, name, description, tags })
    return this.guild.stickers.create({ file, name, description: description || name, tags: tags || name });
  }
}

module.exports = { DiscordStickerTransport };
