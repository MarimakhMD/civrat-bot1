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
  NOT_AN_IMAGE: "NOT_AN_IMAGE",
  TOO_MANY_PIXELS: "TOO_MANY_PIXELS",
});

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

/** Télécharge la pièce jointe, avec délai maximal. */
async function fetchWelcomeImageBuffer(attachment) {
  if (typeof attachment?.url !== "string" || !attachment.url) {
    return { ok: false, reason: WelcomeImageRejectReason.MISSING_ATTACHMENT };
  }
  try {
    const response = await fetch(attachment.url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) return { ok: false, reason: WelcomeImageRejectReason.FETCH_FAILED };
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0) return { ok: false, reason: WelcomeImageRejectReason.EMPTY_FILE };
    return { ok: true, buffer };
  } catch {
    return { ok: false, reason: WelcomeImageRejectReason.FETCH_FAILED };
  }
}

/**
 * Décodage réel : prouve que le buffer est une image et fournit ses dimensions.
 * @returns {Promise<{ok:true,width:number,height:number}|{ok:false,reason:string}>}
 */
async function decodeWelcomeImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return { ok: false, reason: WelcomeImageRejectReason.NOT_AN_IMAGE };
  }
  let image;
  try {
    image = await loadImage(buffer);
  } catch {
    return { ok: false, reason: WelcomeImageRejectReason.NOT_AN_IMAGE };
  }
  const width = Number(image.width);
  const height = Number(image.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { ok: false, reason: WelcomeImageRejectReason.NOT_AN_IMAGE };
  }
  if (width * height > MAX_IMAGE_PIXELS) {
    return { ok: false, reason: WelcomeImageRejectReason.TOO_MANY_PIXELS };
  }
  return { ok: true, width, height };
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
  formatImageSize,
};
