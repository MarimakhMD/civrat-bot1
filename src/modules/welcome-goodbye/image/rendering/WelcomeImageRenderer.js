"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { createCanvas, loadImage } = require("@napi-rs/canvas");
const { WelcomeImagePayload } = require("../contracts/WelcomeImagePayload");

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

  async #drawBackground(ctx, template, design, width, height) {
    const background = design.background || {};
    if (background.image && template.assetsPath) {
      try {
        const file = path.join(template.assetsPath, background.image);
        if (fs.existsSync(file)) {
          const image = await loadImage(file);
          const scale = Math.max(width / image.width, height / image.height);
          const drawWidth = image.width * scale;
          const drawHeight = image.height * scale;
          ctx.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
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
      const size = avatar.radius * 2;
      ctx.drawImage(image, avatar.cx - avatar.radius, avatar.cy - avatar.radius, size, size);
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
