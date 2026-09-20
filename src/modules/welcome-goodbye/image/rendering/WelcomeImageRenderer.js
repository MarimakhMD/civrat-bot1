"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { createCanvas, loadImage } = require("@napi-rs/canvas");
const { WelcomeImagePayload } = require("../contracts/WelcomeImagePayload");
const { inspectImageHeader } = require("../../services/welcomeImageUploadValidation");

const AVATAR_FETCH_TIMEOUT_MS = 3000;

// Network failures, invalid URLs and non-image payloads must never break card
// generation: the loader resolves to null and the renderer draws a fallback.
async function defaultAvatarLoader(url) {
  if (!url || typeof url !== "string") return null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(AVATAR_FETCH_TIMEOUT_MS) });
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer.length > 0 ? buffer : null;
  } catch {
    return null;
  }
}

function truncateToWidth(ctx, text, maxWidth) {
  const value = String(text);
  if (ctx.measureText(value).width <= maxWidth) return value;
  let out = value;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) out = out.slice(0, -1);
  return `${out}…`;
}

class WelcomeImageRenderer {
  constructor({ avatarLoader = defaultAvatarLoader, resourceCache = null } = {}) {
    this.avatarLoader = avatarLoader;
    this.resourceCache = resourceCache;
  }

  async render(request, theme) {
    if (theme && theme.design) return this.#renderCard(request, theme);
    return this.#renderLegacy(request, theme);
  }

  // Historical minimal theme rendering kept for backward compatibility.
  async #renderLegacy(request, theme) {
    const canvas = createCanvas(request.dimensions.width, request.dimensions.height);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = theme.background;
    ctx.fillRect(0, 0, request.dimensions.width, request.dimensions.height);
    ctx.fillStyle = theme.accent;
    ctx.fillRect(0, 0, 12, request.dimensions.height);
    let y = 120;
    for (const text of request.textElements) {
      ctx.fillStyle = text.color || "#ffffff";
      ctx.font = `${text.size || 42}px ${theme.font}`;
      ctx.fillText(text.content, 60, y);
      y += text.size || 42;
    }
    return new WelcomeImagePayload({ buffer: canvas.toBuffer("image/png"), width: request.dimensions.width, height: request.dimensions.height });
  }

  async #renderCard(request, template) {
    const design = template.design;
    const width = design.width || request.dimensions.width;
    const height = design.height || request.dimensions.height;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    await this.#drawBackground(ctx, template, design, width, height);
    if (design.avatar) await this.#drawAvatar(ctx, request, design);
    this.#drawTextSlots(ctx, request, design, width);
    return new WelcomeImagePayload({ buffer: canvas.toBuffer("image/png"), width, height });
  }

  /**
   * Géométrie « cover » d'une image dans une boîte : plus petit agrandissement
   * qui couvre toute la boîte, centré, donc rogné sur le bord excédentaire.
   * Le rapport de l'image est conservé — il n'y a jamais d'étirement.
   *
   * Retourne des coordonnées RELATIVES à la boîte ; l'appelant les translate.
   * @returns {{dx:number,dy:number,dw:number,dh:number}}
   */
  #coverRect(image, boxWidth, boxHeight) {
    const sourceWidth = Number(image.width) || 0;
    const sourceHeight = Number(image.height) || 0;
    if (sourceWidth <= 0 || sourceHeight <= 0) return { dx: 0, dy: 0, dw: boxWidth, dh: boxHeight };
    const scale = Math.max(boxWidth / sourceWidth, boxHeight / sourceHeight);
    const drawWidth = sourceWidth * scale;
    const drawHeight = sourceHeight * scale;
    return { dx: (boxWidth - drawWidth) / 2, dy: (boxHeight - drawHeight) / 2, dw: drawWidth, dh: drawHeight };
  }

  /**
   * Recadrage « cover » : l'image remplit toute la carte, centrée, rognée si
   * besoin. UN SEUL code de dessin pour l'asset du template et l'image
   * personnalisée — les deux sources sont donc recadrées strictement à
   * l'identique, ce qui est exigé pour que l'aperçu et la livraison concordent.
   */
  #drawCovered(ctx, image, width, height) {
    const box = this.#coverRect(image, width, height);
    ctx.drawImage(image, box.dx, box.dy, box.dw, box.dh);
  }

  async #drawBackground(ctx, template, design, width, height) {
    const background = design.background || {};

    // Image Welcome personnalisée (Premium) : déjà chargée en mémoire par le
    // service de ressources, jamais lue depuis un chemin fourni par la config.
    // Elle est prioritaire sur l'asset du template ; si elle est illisible, on
    // retombe sur l'asset puis sur le dégradé déclaratif — le Welcome n'est
    // jamais bloqué par une image invalide.
    if (background.buffer) {
      // En-tête vérifié AVANT le décodage : Skia SIGSEGV sur un buffer dont la
      // signature d'image est valide mais l'en-tête incohérent, et un
      // try/catch n'arrête pas un signal. Sans ce garde-fou, une image
      // téléversée puis corrompue ferait tomber le processus à chaque arrivée
      // de membre.
      if (inspectImageHeader(background.buffer).ok) {
        try {
          this.#drawCovered(ctx, await loadImage(background.buffer), width, height);
          return;
        } catch {
          // Buffer non décodable → on poursuit vers les sources suivantes.
        }
      }
    }

    if (background.image && template.assetsPath) {
      try {
        const file = path.join(template.assetsPath, background.image);
        if (fs.existsSync(file)) {
          this.#drawCovered(ctx, await loadImage(file), width, height);
          return;
        }
      } catch {
        // Asset unreadable → fall back to the declarative gradient below.
      }
    }
    const colors = Array.isArray(background.colors) && background.colors.length ? background.colors : ["#111827"];
    if (colors.length === 1) {
      ctx.fillStyle = colors[0];
    } else {
      const gradient = ctx.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, colors[0]);
      gradient.addColorStop(1, colors[colors.length - 1]);
      ctx.fillStyle = gradient;
    }
    ctx.fillRect(0, 0, width, height);
  }

  async #drawAvatar(ctx, request, design) {
    const avatar = design.avatar;
    let image = null;
    let buffer = request.avatarUrl && this.resourceCache ? this.resourceCache.get(request.avatarUrl) : null;
    if (!buffer && this.avatarLoader) {
      try {
        buffer = await this.avatarLoader(request.avatarUrl);
      } catch {
        buffer = null;
      }
    }
    if (buffer) {
      try {
        image = await loadImage(buffer);
        if (request.avatarUrl && this.resourceCache) this.resourceCache.set(request.avatarUrl, buffer);
      } catch {
        image = null;
      }
    }
    ctx.beginPath();
    ctx.arc(avatar.cx, avatar.cy, avatar.radius, 0, Math.PI * 2);
    ctx.closePath();
    if (image) {
      ctx.save();
      ctx.clip();
      // « cover » et non étirement : `drawImage(img, dx, dy, dw, dh)` met à
      // l'échelle vers dw×dh sans tenir compte du rapport de la source. Un
      // avatar non carré était donc DÉFORMÉ pour remplir le cercle. On calcule
      // ici la géométrie cover dans la boîte du cercle, puis on la translate au
      // centre : le cercle est intégralement couvert, le rapport est conservé,
      // l'excédent est rogné par le clip déjà posé.
      const size = avatar.radius * 2;
      const box = this.#coverRect(image, size, size);
      ctx.drawImage(
        image,
        avatar.cx - avatar.radius + box.dx,
        avatar.cy - avatar.radius + box.dy,
        box.dw,
        box.dh,
      );
      ctx.restore();
    } else {
      // Clean fallback: accent disc with the member initial.
      ctx.fillStyle = design.accent || "#5865f2";
      ctx.fill();
      const initial = (request.displayName || "?").toString().trim().charAt(0).toUpperCase() || "?";
      ctx.fillStyle = "#ffffff";
      ctx.font = `${Math.round(avatar.radius * 0.8)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(initial, avatar.cx, avatar.cy + Math.round(avatar.radius * 0.04));
    }
    if (avatar.ringWidth) {
      ctx.beginPath();
      ctx.arc(avatar.cx, avatar.cy, avatar.radius, 0, Math.PI * 2);
      ctx.lineWidth = avatar.ringWidth;
      ctx.strokeStyle = avatar.ringColor || "#ffffff";
      ctx.stroke();
    }
  }

  #drawTextSlots(ctx, request, design, width) {
    const contentOf = (id) => {
      const element = request.textElements.find((entry) => entry.id === id);
      return element && element.content ? String(element.content) : "";
    };
    for (const [id, slot] of [["title", design.title], ["subtitle", design.subtitle]]) {
      if (!slot) continue;
      const content = contentOf(id);
      if (!content) continue;
      ctx.fillStyle = slot.color || "#ffffff";
      ctx.font = `${slot.size || 42}px sans-serif`;
      ctx.textAlign = slot.align || "left";
      ctx.textBaseline = "alphabetic";
      const maxWidth = Math.max(60, width - slot.x - 60);
      ctx.fillText(truncateToWidth(ctx, content, maxWidth), slot.x, slot.y);
    }
  }
}

module.exports = { WelcomeImageRenderer, defaultAvatarLoader };
