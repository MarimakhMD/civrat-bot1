"use strict";

const { loadImage } = require("@napi-rs/canvas");

/**
 * Validation de l'image Welcome téléversée depuis Discord.
 *
 * Deux niveaux, dans cet ordre :
 *  1. les MÉTADONNÉES de la pièce jointe (`contentType`, `size`) — aucun octet
 *     n'est téléchargé si elles sont mauvaises ;
 *  2. le DÉCODAGE RÉEL du buffer — une extension ou un contentType mensonger ne
 *     suffit pas, l'image doit réellement se décoder.
 *
 * La taille maximale n'est JAMAIS codée en dur : elle vient de
 * `interaction.attachmentSizeLimit`, fourni par l'API Discord et propre à chaque
 * serveur (il dépend du niveau de boost). Toute constante serait fausse sur une
 * partie des guildes.
 */

/** Formats réellement acceptés par @napi-rs/canvas (vérifié par exécution). */
const ACCEPTED_IMAGE_CONTENT_TYPES = Object.freeze([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/avif",
  "image/gif",
]);

const WelcomeImageRejectReason = Object.freeze({
  MISSING_ATTACHMENT: "MISSING_ATTACHMENT",
  UNSUPPORTED_FORMAT: "UNSUPPORTED_FORMAT",
  EMPTY_FILE: "EMPTY_FILE",
  TOO_LARGE: "TOO_LARGE",
  FETCH_FAILED: "FETCH_FAILED",
  // Le CDN Discord a répondu 200 mais le CORPS n'est pas une image (page
  // d'erreur HTML/JSON, proxy d'hébergement, interstitiel). Ce n'est PAS une
  // faute de l'utilisateur : le distinguer évite un message trompeur.
  CDN_UNEXPECTED_CONTENT: "CDN_UNEXPECTED_CONTENT",
  NOT_AN_IMAGE: "NOT_AN_IMAGE",
  // La signature est celle d'une image mais le décodage échoue : fichier
  // réellement corrompu OU décodeur indisponible sur l'hôte. L'erreur d'origine
  // est journalisée, elle n'est plus jamais avalée.
  DECODE_FAILED: "DECODE_FAILED",
  TOO_MANY_PIXELS: "TOO_MANY_PIXELS",
});

/**
 * Signatures magiques des formats acceptés. Discord déduit `content_type` de
 * l'EXTENSION et non du contenu : cette vérification porte sur les octets, donc
 * elle distingue « fichier invalide » de « téléchargement corrompu ».
 */
function detectImageFormat(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  const head = buffer.subarray(0, 12).toString("hex");
  if (head.startsWith("89504e470d0a1a0a")) return "png";
  if (head.startsWith("ffd8ff")) return "jpeg";
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  if (head.startsWith("47494638")) return "gif";
  if (buffer.subarray(4, 12).toString("ascii") === "ftypavif") return "avif";
  return null;
}

/**
 * Lecture des dimensions et des champs d'en-tête SANS décoder.
 *
 * Indispensable, pas seulement pratique : `@napi-rs/canvas`/Skia SIGSEGV sur un
 * PNG dont la signature est valide mais l'IHDR incohérent (hauteur nulle,
 * bitDepth ou colorType hors jeu, largeur énorme). Un fichier artisanal de
 * quelques octets suffirait alors à faire tomber tout le processus du bot.
 *
 * Vérifier l'en-tête AVANT `loadImage` :
 *  - transforme un crash de processus en refus propre ;
 *  - rend la limite de pixels réellement effective (elle était jusqu'ici
 *    évaluée APRÈS le décodage, donc trop tard pour un IHDR piégé).
 *
 * @returns {{ok:true,format:string,width:number,height:number}|{ok:false,reason:string}}
 */
function inspectImageHeader(buffer) {
  const format = detectImageFormat(buffer);
  if (!format) return { ok: false, reason: "no-signature" };

  try {
    if (format === "png") {
      // signature(8) + longueur(4) + "IHDR"(4) + largeur(4) + hauteur(4) + 5 octets
      if (buffer.length < 29) return { ok: false, reason: "truncated-header" };
      if (buffer.readUInt32BE(8) !== 13 || buffer.toString("ascii", 12, 16) !== "IHDR") return { ok: false, reason: "bad-ihdr-chunk" };
      const width = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);
      const bitDepth = buffer[24];
      const colorType = buffer[25];
      const compression = buffer[26];
      const filter = buffer[27];
      const interlace = buffer[28];
      if (![1, 2, 4, 8, 16].includes(bitDepth)) return { ok: false, reason: "bad-bit-depth" };
      if (![0, 2, 3, 4, 6].includes(colorType)) return { ok: false, reason: "bad-color-type" };
      if (compression !== 0 || filter !== 0 || interlace > 1) return { ok: false, reason: "bad-ihdr-flags" };
      const chunks = inspectPngChunks(buffer);
      if (chunks !== true) return { ok: false, reason: chunks };
      return { ok: true, format, width, height };
    }

    if (format === "gif") {
      if (buffer.length < 10) return { ok: false, reason: "truncated-header" };
      return { ok: true, format, width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
    }

    if (format === "jpeg") {
      // Parcours des marqueurs jusqu'au premier SOFn (hors DHT/JPG/DAC).
      let offset = 2;
      while (offset + 9 < buffer.length) {
        if (buffer[offset] !== 0xff) { offset += 1; continue; }
        const marker = buffer[offset + 1];
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { ok: true, format, height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
        }
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
        offset += 2 + buffer.readUInt16BE(offset + 2);
      }
      return { ok: false, reason: "no-sof-marker" };
    }

    if (format === "webp") {
      const fourcc = buffer.toString("ascii", 12, 16);
      if (fourcc === "VP8X") {
        if (buffer.length < 30) return { ok: false, reason: "truncated-header" };
        return { ok: true, format, width: buffer.readUIntLE(24, 3) + 1, height: buffer.readUIntLE(27, 3) + 1 };
      }
      if (fourcc === "VP8 ") {
        if (buffer.length < 30) return { ok: false, reason: "truncated-header" };
        return { ok: true, format, width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
      }
      if (fourcc === "VP8L") {
        if (buffer.length < 25 || buffer[20] !== 0x2f) return { ok: false, reason: "bad-vp8l-signature" };
        const bits = buffer.readUInt32LE(21);
        return { ok: true, format, width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
      return { ok: false, reason: "unknown-webp-variant" };
    }

    if (format === "avif") {
      const at = buffer.indexOf("ispe");
      if (at === -1 || at + 12 > buffer.length) return { ok: false, reason: "no-ispe-box" };
      return { ok: true, format, width: buffer.readUInt32BE(at + 8), height: buffer.readUInt32BE(at + 12) };
    }
  } catch {
    return { ok: false, reason: "header-parse-error" };
  }
  return { ok: false, reason: "unsupported-format" };
}

/**
 * Parcours de la structure de chunks d'un PNG.
 *
 * Un PNG doté d'un IHDR parfaitement valide mais dépourvu de chunk IDAT fait
 * lui aussi SIGSEGV Skia. Vérifier l'IHDR ne suffit donc pas : il faut que la
 * chaîne de chunks soit cohérente et contienne au moins un IDAT.
 *
 * @returns {true|string} true si la structure est saine, sinon la raison du refus.
 */
function inspectPngChunks(buffer) {
  let offset = 8;
  let sawIdat = false;
  let sawIend = false;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    // Un type de chunk est constitué de 4 lettres ASCII ; tout le reste trahit
    // une structure détruite.
    for (let i = offset + 4; i < offset + 8; i++) {
      const byte = buffer[i];
      const isLetter = (byte >= 0x41 && byte <= 0x5a) || (byte >= 0x61 && byte <= 0x7a);
      if (!isLetter) return "bad-chunk-type";
    }
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    // longueur + type + données + CRC(4) doivent tenir dans le buffer.
    if (length > buffer.length - offset - 8 - 4 + 4 && offset + 12 + length > buffer.length) return "truncated-chunk";
    if (offset + 12 + length > buffer.length) return "truncated-chunk";
    if (type === "IDAT") sawIdat = true;
    if (type === "IEND") { sawIend = true; break; }
    offset += 12 + length;
  }
  if (!sawIdat) return "no-idat-chunk";
  if (!sawIend) return "no-iend-chunk";
  return true;
}

/** 16 premiers octets en hexadécimal : ce qui permet d'identifier un interstitiel. */
function hexHead(buffer, count = 16) {
  if (!Buffer.isBuffer(buffer)) return "";
  return [...buffer.subarray(0, count)].map((b) => b.toString(16).padStart(2, "0")).join(" ");
}

/**
 * Garde-fou anti « bombe de décompression » : un fichier de quelques ko peut
 * décoder en des dizaines de milliers de pixels de côté et épuiser la mémoire.
 * 4096×4096 couvre très largement la carte (1296×292) et tout usage raisonnable.
 */
const MAX_IMAGE_PIXELS = 4096 * 4096;

const FETCH_TIMEOUT_MS = 10000;

function normalizeContentType(value) {
  return typeof value === "string" ? value.split(";")[0].trim().toLowerCase() : "";
}

/**
 * Contrôle des métadonnées, sans aucun téléchargement.
 * @returns {{ok:true}|{ok:false,reason:string}}
 */
function checkWelcomeImageAttachment({ attachment = null, attachmentSizeLimit = null } = {}) {
  if (!attachment || typeof attachment !== "object") {
    return { ok: false, reason: WelcomeImageRejectReason.MISSING_ATTACHMENT };
  }
  if (!ACCEPTED_IMAGE_CONTENT_TYPES.includes(normalizeContentType(attachment.contentType))) {
    return { ok: false, reason: WelcomeImageRejectReason.UNSUPPORTED_FORMAT };
  }
  const size = Number(attachment.size);
  if (!Number.isFinite(size) || size <= 0) {
    return { ok: false, reason: WelcomeImageRejectReason.EMPTY_FILE };
  }
  // `attachmentSizeLimit` absent (ancien payload, test) ⇒ on ne devine pas de
  // plafond : le contrôle porte alors sur le seul `size` positif, et le décodage
  // reste la vraie barrière.
  if (Number.isFinite(Number(attachmentSizeLimit)) && Number(attachmentSizeLimit) > 0 && size > Number(attachmentSizeLimit)) {
    return { ok: false, reason: WelcomeImageRejectReason.TOO_LARGE };
  }
  return { ok: true };
}

/**
 * Un seul essai de téléchargement. Ne lève JAMAIS : tout échec est décrit dans
 * `detail`, qui est journalisé par l'appelant au lieu d'être avalé.
 */
async function downloadWelcomeImageOnce(url, attachment) {
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (error) {
    return {
      ok: false,
      reason: WelcomeImageRejectReason.FETCH_FAILED,
      detail: { url, stage: "connect", errorName: error?.name || null, errorMessage: error?.message || null },
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      reason: WelcomeImageRejectReason.FETCH_FAILED,
      detail: { url, stage: "status", status: response.status, httpContentType: response.headers?.get?.("content-type") || null },
    };
  }

  let buffer;
  try {
    buffer = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    return {
      ok: false,
      reason: WelcomeImageRejectReason.FETCH_FAILED,
      detail: { url, stage: "body", errorName: error?.name || null, errorMessage: error?.message || null },
    };
  }

  const httpContentType = response.headers?.get?.("content-type") || null;
  if (buffer.length === 0) {
    return { ok: false, reason: WelcomeImageRejectReason.EMPTY_FILE, detail: { url, stage: "body", httpContentType } };
  }

  // Le CORPS est-il réellement une image ? Un proxy d'hébergement ou un
  // interstitiel réseau répond 200 avec du HTML/JSON : sans ce contrôle, ce cas
  // était rapporté comme « fichier invalide », ce qui accuse l'utilisateur à tort.
  const format = detectImageFormat(buffer);
  if (!format) {
    return {
      ok: false,
      reason: WelcomeImageRejectReason.CDN_UNEXPECTED_CONTENT,
      detail: { url, stage: "content", httpContentType, bytes: buffer.length, head: hexHead(buffer), preview: buffer.subarray(0, 120).toString("utf8").replace(/[\u0000-\u001f]/g, " ") },
    };
  }

  // Un écart de taille n'est PAS un rejet : le proxy Discord peut servir une
  // variante réencodée. C'est un signal diagnostique, journalisé par l'appelant.
  const expected = Number(attachment?.size);
  const sizeMismatch = Number.isFinite(expected) && expected > 0 && buffer.length !== expected;

  return { ok: true, buffer, format, detail: { url, stage: "ok", bytes: buffer.length, expectedSize: Number.isFinite(expected) ? expected : null, sizeMismatch } };
}

/**
 * Télécharge la pièce jointe, avec délai maximal.
 *
 * Essaie `attachment.url` (CDN) puis `attachment.proxyURL` (proxy Discord) :
 * sur certains hébergements l'un des deux est filtré alors que l'autre passe.
 * Chaque tentative échouée est décrite précisément, jamais avalée.
 */
async function fetchWelcomeImageBuffer(attachment, { logger = null, guildId = null } = {}) {
  const candidates = [];
  for (const url of [attachment?.url, attachment?.proxyURL]) {
    if (typeof url === "string" && url && !candidates.includes(url)) candidates.push(url);
  }
  if (candidates.length === 0) {
    logger?.warn?.("Welcome image download skipped: attachment has no URL", { guildId });
    return { ok: false, reason: WelcomeImageRejectReason.MISSING_ATTACHMENT, detail: { urls: [] } };
  }

  let last = null;
  for (const [index, url] of candidates.entries()) {
    const attempt = await downloadWelcomeImageOnce(url, attachment);
    if (attempt.ok) {
      if (attempt.detail.sizeMismatch) {
        logger?.warn?.("Welcome image downloaded with unexpected size", { guildId, ...attempt.detail, format: attempt.format });
      }
      if (index > 0) logger?.info?.("Welcome image downloaded from fallback URL", { guildId, url });
      return attempt;
    }
    last = attempt;
    logger?.warn?.("Welcome image download attempt failed", { guildId, attempt: index + 1, of: candidates.length, reason: attempt.reason, ...attempt.detail });
  }
  return last;
}

/**
 * Décodage réel : prouve que le buffer est une image et fournit ses dimensions.
 * @returns {Promise<{ok:true,width:number,height:number}|{ok:false,reason:string}>}
 */
async function decodeWelcomeImage(buffer, { logger = null, guildId = null } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    logger?.warn?.("Welcome image decode rejected: empty buffer", { guildId, bytes: Buffer.isBuffer(buffer) ? buffer.length : null });
    return { ok: false, reason: WelcomeImageRejectReason.NOT_AN_IMAGE, detail: { bytes: 0 } };
  }

  const format = detectImageFormat(buffer);

  // 1) En-tête d'abord : un IHDR incohérent fait SIGSEGV Skia et tuerait le
  //    processus entier. On refuse AVANT de passer la main au décodeur.
  const header = inspectImageHeader(buffer);
  if (!header.ok) {
    const detail = { bytes: buffer.length, format: format || "unknown", head: hexHead(buffer), headerReason: header.reason };
    logger?.warn?.("Welcome image header rejected before decoding", { guildId, ...detail });
    return { ok: false, reason: WelcomeImageRejectReason.NOT_AN_IMAGE, detail };
  }

  // 2) Limite de pixels évaluée sur l'EN-TÊTE, donc avant tout décodage : c'est
  //    ce qui bloque réellement une bombe de décompression déclarée dans l'IHDR.
  if (!Number.isFinite(header.width) || !Number.isFinite(header.height) || header.width <= 0 || header.height <= 0) {
    const detail = { bytes: buffer.length, format: header.format, width: header.width, height: header.height, headerReason: header.reason || null, head: hexHead(buffer) };
    logger?.warn?.("Welcome image header has invalid dimensions", { guildId, ...detail });
    return { ok: false, reason: WelcomeImageRejectReason.NOT_AN_IMAGE, detail };
  }
  if (header.width * header.height > MAX_IMAGE_PIXELS) {
    const detail = { bytes: buffer.length, format: header.format, width: header.width, height: header.height, limit: MAX_IMAGE_PIXELS };
    logger?.warn?.("Welcome image exceeds pixel limit", { guildId, ...detail });
    return { ok: false, reason: WelcomeImageRejectReason.TOO_MANY_PIXELS, detail };
  }

  // 3) Décodage réel, sur un en-tête déjà jugé cohérent.
  let image;
  try {
    image = await loadImage(buffer);
  } catch (error) {
    // L'erreur d'origine est CONSERVÉE et journalisée : c'est elle qui manquait
    // pour distinguer un fichier corrompu d'un décodeur indisponible.
    const detail = { bytes: buffer.length, format: format || "unknown", head: hexHead(buffer), errorName: error?.name || null, errorMessage: error?.message || null };
    logger?.warn?.("Welcome image decode failed", { guildId, ...detail });
    return {
      ok: false,
      // Signature d'image reconnue mais décodage impossible → DECODE_FAILED
      // (fichier corrompu ou décodeur HS). Aucune signature → pas une image.
      reason: format ? WelcomeImageRejectReason.DECODE_FAILED : WelcomeImageRejectReason.NOT_AN_IMAGE,
      detail,
    };
  }

  const width = Number(image.width);
  const height = Number(image.height);
  // Double contrôle : les dimensions réellement décodées doivent rester dans la
  // limite, même si un conteneur annonçait autre chose dans son en-tête.
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || width * height > MAX_IMAGE_PIXELS) {
    const detail = { bytes: buffer.length, format: header.format, width, height, limit: MAX_IMAGE_PIXELS };
    logger?.warn?.("Welcome image decoded outside the allowed dimensions", { guildId, ...detail });
    return { ok: false, reason: WelcomeImageRejectReason.TOO_MANY_PIXELS, detail };
  }
  return { ok: true, width, height, format: header.format };
}

/**
 * Formate une taille en octets en mégaoctets, SANS unité : l'unité (« Mo » /
 * « MB ») vient de la traduction, afin que le message reste intégralement dans
 * la langue de la guilde.
 */
function formatImageSize(value) {
  const size = Number(value);
  if (!Number.isFinite(size) || size <= 0) return "0";
  const mega = size / (1024 * 1024);
  return `${mega >= 10 ? Math.round(mega) : Math.round(mega * 10) / 10}`;
}

module.exports = {
  ACCEPTED_IMAGE_CONTENT_TYPES,
  WelcomeImageRejectReason,
  MAX_IMAGE_PIXELS,
  checkWelcomeImageAttachment,
  fetchWelcomeImageBuffer,
  decodeWelcomeImage,
  detectImageFormat,
  inspectImageHeader,
  inspectPngChunks,
  hexHead,
  formatImageSize,
};
