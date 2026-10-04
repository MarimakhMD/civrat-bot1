"use strict";

const { STICKER_LIMIT_FREE } = require("../configuration/stickerConstants");
const { RATE_LIMITS, sharedRateLimitGuard } = require("../../../core/rateLimit/ActionRateLimitGuard");

/** Limite API Discord d'un sticker : 512 KiB (documentation officielle). */
const MAX_STICKER_BYTES = 512 * 1024;

/**
 * P12 — formats acceptés en PRÉVALIDATION métadonnées (attachment Discord).
 * Formats sticker Discord : PNG, APNG, GIF, Lottie JSON. `image/jpeg` est
 * volontairement exclu.
 *
 * ATTENTION : ce contrôle porte sur une métadonnée d'entrée fournie par
 * Discord (déduite de l'extension) — c'est une prévalidation, PAS une preuve
 * du contenu réel. Le filet de sécurité du format réel et de la taille reste
 * l'API Discord, après transmission (aucun remplacement du flux discord.js).
 */
const ACCEPTED_STICKER_CONTENT_TYPES = Object.freeze([
  "image/png",
  "image/apng",
  "image/gif",
  "application/json",
]);

const StickerErrorCode = Object.freeze({
  MISSING_FILE: "STICKER_MISSING_FILE",
  INVALID_NAME: "STICKER_INVALID_NAME",
  UNSUPPORTED_FORMAT: "STICKER_UNSUPPORTED_FORMAT",
  INVALID_SIZE: "STICKER_INVALID_SIZE",
  TOO_LARGE: "STICKER_TOO_LARGE",
  LIMIT_REACHED: "STICKER_LIMIT_REACHED",
  RATE_LIMITED: "STICKER_RATE_LIMITED",
  UPLOAD_FAILED: "STICKER_UPLOAD_FAILED",
  FETCH_FAILED: "STICKER_FETCH_FAILED",
});

class StickerService {
  constructor({ limit = STICKER_LIMIT_FREE } = {}) {
    this.limit = Number.isFinite(limit) ? limit : STICKER_LIMIT_FREE;
  }

  validate({ file, name, attachmentSizeLimit = null }) {
    if (!file) return { ok: false, code: StickerErrorCode.MISSING_FILE };
    if (!name || typeof name !== "string" || name.trim().length < 2 || name.trim().length > 30) {
      return { ok: false, code: StickerErrorCode.INVALID_NAME };
    }

    // P12 — MIME : présent mais hors liste ⇒ refus local (avant tout fetch).
    // Absent (null/undefined/string vide/non-string) ⇒ fail-open documenté :
    // le filet API Discord reste en place et les payloads existants sans
    // contentType ne sont pas cassés.
    const contentType = typeof file.contentType === "string"
      ? file.contentType.split(";")[0].trim().toLowerCase()
      : "";
    if (contentType && !ACCEPTED_STICKER_CONTENT_TYPES.includes(contentType)) {
      return { ok: false, code: StickerErrorCode.UNSUPPORTED_FORMAT };
    }

    // P12 — taille : absente ⇒ fail-open (aucune nouvelle règle stricte) ;
    // présente mais invalide (NaN, non finie, ≤ 0) ⇒ refus fail-closed, sans
    // crash ; > 512 KiB ou > attachmentSizeLimit du serveur ⇒ refus local.
    if (file.size !== undefined && file.size !== null) {
      const size = Number(file.size);
      if (!Number.isFinite(size) || size <= 0) {
        return { ok: false, code: StickerErrorCode.INVALID_SIZE };
      }
      if (size > MAX_STICKER_BYTES) {
        return { ok: false, code: StickerErrorCode.TOO_LARGE };
      }
      const limit = Number(attachmentSizeLimit);
      if (Number.isFinite(limit) && limit > 0 && size > limit) {
        return { ok: false, code: StickerErrorCode.TOO_LARGE };
      }
    }

    return { ok: true, code: null };
  }

  /**
   * Ordre P12 : validation métadonnées → rate limit Sticker (Option D) →
   * count → createSticker (filet API Discord inchangé). Un refus local ne
   * déclenche ni count, ni fetch CDN, ni consommation de crédit rate limit.
   */
  async upload({
    file,
    name,
    description,
    tags,
    transport,
    guildId = null,
    userId = null,
    attachmentSizeLimit = null,
    rateLimitGuard = null,
  }) {
    const validation = this.validate({ file, name, attachmentSizeLimit });
    if (!validation.ok) return validation;

    // Rate limit consommé UNIQUEMENT après validations réussies — pattern P6
    // (mémoire, expiration lazy, isolation guild:user:group, garde partagé).
    // Fail-open sans acteur : jamais de crash si guildId/userId manquent.
    if (guildId && userId) {
      const guard = rateLimitGuard || sharedRateLimitGuard;
      const { group, limit, windowMs } = RATE_LIMITS.STICKER;
      const gate = guard.check({ guildId, userId, group, limit, windowMs });
      if (!gate.allowed) {
        return {
          ok: false,
          code: StickerErrorCode.RATE_LIMITED,
          details: { retryAfterMs: gate.retryAfterMs },
        };
      }
      guard.record({ guildId, userId, group, limit, windowMs });
    }

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

module.exports = { StickerService, StickerErrorCode, STICKER_LIMIT_FREE, ACCEPTED_STICKER_CONTENT_TYPES, MAX_STICKER_BYTES };
