"use strict";

const { STICKER_LIMIT_FREE } = require("../configuration/stickerConstants");

const StickerErrorCode = Object.freeze({
  MISSING_FILE: "STICKER_MISSING_FILE",
  INVALID_NAME: "STICKER_INVALID_NAME",
  LIMIT_REACHED: "STICKER_LIMIT_REACHED",
  UPLOAD_FAILED: "STICKER_UPLOAD_FAILED",
  FETCH_FAILED: "STICKER_FETCH_FAILED",
});

class StickerService {
  constructor({ limit = STICKER_LIMIT_FREE } = {}) {
    this.limit = Number.isFinite(limit) ? limit : STICKER_LIMIT_FREE;
  }

  validate({ file, name }) {
    if (!file) return { ok: false, code: StickerErrorCode.MISSING_FILE };
    if (!name || typeof name !== "string" || name.trim().length < 2 || name.trim().length > 30) {
      return { ok: false, code: StickerErrorCode.INVALID_NAME };
    }
    return { ok: true, code: null };
  }

  async upload({ file, name, description, tags, transport }) {
    const validation = this.validate({ file, name });
    if (!validation.ok) return validation;

    let count = 0;
    try {
      count = await transport.countStickers();
    } catch {
      return { ok: false, code: StickerErrorCode.FETCH_FAILED };
    }

    if (count >= this.limit) {
      return { ok: false, code: StickerErrorCode.LIMIT_REACHED, details: { count, limit: this.limit } };
    }

    try {
      const sticker = await transport.createSticker({ file, name: name.trim(), description: description || name.trim(), tags: tags || name.trim() });
      return { ok: true, code: "STICKER_UPLOADED", sticker, details: { count: count + 1, limit: this.limit } };
    } catch {
      return { ok: false, code: StickerErrorCode.UPLOAD_FAILED };
    }
  }
}

module.exports = { StickerService, StickerErrorCode, STICKER_LIMIT_FREE };
