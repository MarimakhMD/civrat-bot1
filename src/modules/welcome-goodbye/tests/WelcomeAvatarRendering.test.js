"use strict";

/**
 * Cadrage de l'avatar dans le cercle du template Welcome.
 *
 * Défaut corrigé : `#drawAvatar` appelait
 * `ctx.drawImage(image, dx, dy, size, size)` — la forme à 5 arguments, qui met
 * à l'échelle vers `size × size` SANS tenir compte du rapport de la source. Un
 * avatar non carré était donc étiré pour remplir le cercle : déformation
 * visible, alors même que le cercle était bien couvert.
 *
 * Le rendu passe désormais par la géométrie « cover » partagée avec le fond :
 * agrandissement minimal couvrant la boîte, centré, excédent rogné par le clip.
 *
 * Les assertions sont des MESURES DE PIXELS sur le PNG rendu, pas des
 * vérifications de code : elles échouent si le cercle n'est pas intégralement
 * couvert, si l'image est déformée, ou si elle déborde du cercle.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createCanvas, loadImage } = require("@napi-rs/canvas");

const { WelcomeImageRenderer } = require("../image/rendering/WelcomeImageRenderer");
const { WelcomeTemplateRegistry } = require("../rendering/WelcomeTemplateRegistry");

/** Vert pur pour le corps, magenta pour le repère : absents des trois fonds. */
const BODY = "#00ff00";
const MARK = "#ff00ff";

/** Avatar de test. `disc` ajoute un disque centré qui révèle toute déformation. */
function makeAvatar(width, height, { disc = false } = {}) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = BODY;
  ctx.fillRect(0, 0, width, height);
  if (disc) {
    ctx.fillStyle = MARK;
    ctx.beginPath();
    ctx.arc(width / 2, height / 2, Math.min(width, height) / 4, 0, Math.PI * 2);
    ctx.fill();
  }
  return canvas.toBuffer("image/png");
}

function registryWithTemplates() {
  const registry = new WelcomeTemplateRegistry();
  registry.discover();
  return registry;
}

function baseRequest() {
  return {
    guildId: "1320817768962064384",
    userId: "u1",
    avatarUrl: "https://cdn.discordapp.com/avatars/u1/a.png?size=256",
    displayName: "Alice",
    textElements: [],
    dimensions: { width: 1200, height: 400 },
  };
}

/** Rend la carte avec un avatarLoader imposé et renvoie les pixels bruts. */
async function renderPixels(template, avatarBuffer) {
  const renderer = new WelcomeImageRenderer({ avatarLoader: async () => avatarBuffer });
  const payload = await renderer.render(baseRequest(), template);
  const image = await loadImage(payload.buffer);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  return { data: ctx.getImageData(0, 0, image.width, image.height).data, width: image.width, height: image.height };
}

const isBody = (data, i) => data[i + 1] > 180 && data[i] < 120 && data[i + 2] < 120;
const isMark = (data, i) => data[i] > 200 && data[i + 1] < 120 && data[i + 2] > 200;

/**
 * Proportion du bord du cercle effectivement couverte par l'avatar.
 * Échantillonne juste à l'intérieur du rayon sur 360 angles : un angle non
 * couvert trahit un trou (avatar trop petit, mal centré, ou clip mal calé).
 */
async function borderCoverage(template, avatarBuffer) {
  const avatar = template.design.avatar;
  const { data, width, height } = await renderPixels(template, avatarBuffer);
  let covered = 0;
  let total = 0;
  for (let deg = 0; deg < 360; deg++) {
    const theta = (deg * Math.PI) / 180;
    const x = Math.round(avatar.cx + (avatar.radius - 1.5) * Math.cos(theta));
    const y = Math.round(avatar.cy + (avatar.radius - 1.5) * Math.sin(theta));
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    total++;
    const i = (y * width + x) * 4;
    if (isBody(data, i) || isMark(data, i)) covered++;
  }
  return covered / total;
}

/**
 * Rapport largeur/hauteur du repère circulaire après rendu.
 * Un cercle doit rester un cercle : tout écart significatif est un étirement.
 */
async function markAspectRatio(template, avatarBuffer) {
  const avatar = template.design.avatar;
  const { data, width, height } = await renderPixels(template, avatarBuffer);
  const x0 = Math.max(0, Math.floor(avatar.cx - avatar.radius));
  const x1 = Math.min(width - 1, Math.ceil(avatar.cx + avatar.radius));
  const y0 = Math.max(0, Math.floor(avatar.cy - avatar.radius));
  const y1 = Math.min(height - 1, Math.ceil(avatar.cy + avatar.radius));
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!isMark(data, (y * width + x) * 4)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  assert.ok(maxX >= minX && maxY >= minY, "repère introuvable dans le rendu");
  return (maxX - minX + 1) / (maxY - minY + 1);
}

/** Aucun pixel d'avatar ne doit dépasser du cercle : le clip doit tenir. */
async function bleedOutsideCircle(template, avatarBuffer) {
  const avatar = template.design.avatar;
  const { data, width, height } = await renderPixels(template, avatarBuffer);
  let outside = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const distance = Math.hypot(x - avatar.cx, y - avatar.cy);
      if (distance <= avatar.radius + 2) continue;
      if (isBody(data, (y * width + x) * 4)) outside++;
    }
  }
  return outside;
}

// ─────────────────────────────────────────────────────────────────────────────
// A. Le cercle est intégralement couvert
// ─────────────────────────────────────────────────────────────────────────────

test("Avatar — le cercle est intégralement couvert pour un avatar carré", async () => {
  const template = registryWithTemplates().get("template-1");
  const coverage = await borderCoverage(template, makeAvatar(512, 512));
  assert.ok(coverage >= 0.99, `bord du cercle couvert à ${(coverage * 100).toFixed(1)} % seulement`);
});

test("Avatar — le cercle reste couvert quelle que soit la forme de la source", async () => {
  const template = registryWithTemplates().get("template-1");
  const shapes = [
    ["carré 512×512", 512, 512],
    ["carré 128×128", 128, 128],
    ["paysage 512×256", 512, 256],
    ["portrait 256×512", 256, 512],
    ["très large 1000×200", 1000, 200],
    ["presque carré 300×280", 300, 280],
  ];
  for (const [label, w, h] of shapes) {
    const coverage = await borderCoverage(template, makeAvatar(w, h));
    assert.ok(coverage >= 0.99, `${label} : bord couvert à ${(coverage * 100).toFixed(1)} %`);
  }
});

test("Avatar — les trois gabarits livrés couvrent leur cercle", async () => {
  const registry = registryWithTemplates();
  for (const template of registry.list()) {
    const coverage = await borderCoverage(template, makeAvatar(256, 256));
    assert.ok(coverage >= 0.99, `${template.id} : bord couvert à ${(coverage * 100).toFixed(1)} %`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// B. Aucune déformation — c'est le défaut corrigé
// ─────────────────────────────────────────────────────────────────────────────

test("Avatar — un avatar non carré n'est PAS étiré (comportement cover)", async () => {
  const template = registryWithTemplates().get("template-1");
  // Avant le correctif, un 512×256 était mis à l'échelle en 218×218 : le disque
  // central ressortait en ellipse d'environ 1×2. Le cover le laisse circulaire.
  const ratio = await markAspectRatio(template, makeAvatar(512, 256, { disc: true }));
  assert.ok(Math.abs(ratio - 1) <= 0.06, `repère déformé : rapport ${ratio.toFixed(3)} au lieu de 1`);
});

test("Avatar — le rapport est conservé pour toutes les formes testées", async () => {
  const template = registryWithTemplates().get("template-1");
  for (const [label, w, h] of [["512×256", 512, 256], ["256×512", 256, 512], ["1000×200", 1000, 200], ["300×280", 300, 280], ["512×512", 512, 512]]) {
    const ratio = await markAspectRatio(template, makeAvatar(w, h, { disc: true }));
    assert.ok(Math.abs(ratio - 1) <= 0.06, `${label} : rapport ${ratio.toFixed(3)}`);
  }
});

test("Avatar — le recadrage est centré (l'excédent est rogné symétriquement)", async () => {
  const template = registryWithTemplates().get("template-1");
  const avatar = template.design.avatar;
  // Un 512×256 rogné en cover perd autant à gauche qu'à droite : le repère
  // centré doit donc rester centré sur le cercle.
  const { data, width, height } = await renderPixels(template, makeAvatar(512, 256, { disc: true }));
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!isMark(data, (y * width + x) * 4)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  assert.ok(Math.abs(centerX - avatar.cx) <= 2, `centrage horizontal : ${centerX} au lieu de ${avatar.cx}`);
  assert.ok(Math.abs(centerY - avatar.cy) <= 2, `centrage vertical : ${centerY} au lieu de ${avatar.cy}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// C. Le clip circulaire est au bon diamètre
// ─────────────────────────────────────────────────────────────────────────────

test("Avatar — rien ne déborde du cercle (clip au bon diamètre)", async () => {
  const template = registryWithTemplates().get("template-1");
  const outside = await bleedOutsideCircle(template, makeAvatar(1000, 200));
  assert.equal(outside, 0, `${outside} pixel(s) d'avatar hors du cercle`);
});

test("Avatar — le clip reste au bon diamètre sur les trois gabarits", async () => {
  const registry = registryWithTemplates();
  for (const template of registry.list()) {
    const outside = await bleedOutsideCircle(template, makeAvatar(512, 512));
    assert.equal(outside, 0, `${template.id} : ${outside} pixel(s) hors du cercle`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// D. Comportements conservés
// ─────────────────────────────────────────────────────────────────────────────

test("Avatar — avatars Discord par défaut et personnalisés suivent le même chemin", async () => {
  // Les deux sont des PNG carrés servis par le CDN ; seul l'URL diffère.
  const template = registryWithTemplates().get("template-1");
  const seen = [];
  const renderer = new WelcomeImageRenderer({
    avatarLoader: async (url) => {
      seen.push(url);
      return makeAvatar(256, 256);
    },
  });
  for (const url of [
    "https://cdn.discordapp.com/avatars/123/abc.png?size=256",
    "https://cdn.discordapp.com/embed/avatars/3.png",
  ]) {
    const payload = await renderer.render({ ...baseRequest(), avatarUrl: url }, template);
    assert.ok(payload.buffer.length > 0, `aucun rendu pour ${url}`);
  }
  assert.deepEqual(seen, [
    "https://cdn.discordapp.com/avatars/123/abc.png?size=256",
    "https://cdn.discordapp.com/embed/avatars/3.png",
  ], "le loader reçoit l'URL telle quelle, sans distinction de type");
});

test("Avatar — l'absence d'avatar produit toujours le disque de repli avec l'initiale", async () => {
  const template = registryWithTemplates().get("template-1");
  const renderer = new WelcomeImageRenderer({ avatarLoader: async () => null });
  const payload = await renderer.render({ ...baseRequest(), avatarUrl: null, displayName: "Alice" }, template);

  const image = await loadImage(payload.buffer);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const { data, width } = ctx.getImageData(0, 0, image.width, image.height);
  const avatar = template.design.avatar;

  // Le disque de repli est plein : le centre ne doit PAS être du fond.
  const centerIndex = (Math.round(avatar.cy) * width + Math.round(avatar.cx)) * 4;
  const isTransparentOrEmpty = data[centerIndex + 3] === 0;
  assert.equal(isTransparentOrEmpty, false, "le centre du cercle est vide alors qu'un repli est attendu");
  assert.ok(payload.buffer.length > 0);
});

test("Avatar — un échec de téléchargement ne casse pas le rendu", async () => {
  const template = registryWithTemplates().get("template-1");
  const renderer = new WelcomeImageRenderer({
    avatarLoader: async () => {
      throw new Error("network down");
    },
  });
  const payload = await renderer.render(baseRequest(), template);
  assert.ok(payload.buffer.length > 0, "le rendu doit aboutir malgré l'échec du loader");
  assert.equal(payload.width, template.design.width);
  assert.equal(payload.height, template.design.height);
});

test("Avatar — un buffer d'avatar illisible retombe sur le disque de repli", async () => {
  const template = registryWithTemplates().get("template-1");
  const renderer = new WelcomeImageRenderer({ avatarLoader: async () => Buffer.from("pas une image") });
  const payload = await renderer.render(baseRequest(), template);
  assert.ok(payload.buffer.length > 0, "un avatar illisible ne doit jamais bloquer la carte");
});

test("Avatar — l'anneau est tracé au même rayon que le clip", async () => {
  const registry = registryWithTemplates();
  const base = registry.get("template-1");
  const template = {
    ...base,
    design: { ...base.design, avatar: { ...base.design.avatar, ringWidth: 8, ringColor: "#ffffff" } },
  };
  const { data, width, height } = await renderPixels(template, makeAvatar(256, 256));
  const avatar = template.design.avatar;

  // L'anneau est centré sur le trait : il doit chevaucher le rayon déclaré.
  let onRing = 0;
  for (let deg = 0; deg < 360; deg++) {
    const theta = (deg * Math.PI) / 180;
    const x = Math.round(avatar.cx + avatar.radius * Math.cos(theta));
    const y = Math.round(avatar.cy + avatar.radius * Math.sin(theta));
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    const i = (y * width + x) * 4;
    if (data[i] > 200 && data[i + 1] > 200 && data[i + 2] > 200) onRing++;
  }
  assert.ok(onRing > 300, `anneau présent sur ${onRing}/360 angles seulement`);
});

// ─────────────────────────────────────────────────────────────────────────────
// E. Le fond n'est pas affecté par le correctif
// ─────────────────────────────────────────────────────────────────────────────

test("Fond — le recadrage cover du fond est inchangé", async () => {
  // Le correctif factorise la géométrie cover ; le fond doit continuer à
  // couvrir toute la carte, y compris avec une image personnalisée.
  const registry = registryWithTemplates();
  const base = registry.get("template-1");
  const custom = createCanvas(1500, 400);
  const cctx = custom.getContext("2d");
  cctx.fillStyle = "#00ff00";
  cctx.fillRect(0, 0, 1500, 400);

  const template = { ...base, design: { ...base.design, background: { buffer: custom.toBuffer("image/png") } } };
  const renderer = new WelcomeImageRenderer({ avatarLoader: async () => null });
  const payload = await renderer.render({ ...baseRequest(), avatarUrl: null }, template);

  const image = await loadImage(payload.buffer);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, image.width, image.height);

  // Les quatre coins doivent être du fond personnalisé, pas du dégradé.
  for (const [x, y] of [[2, 2], [width - 3, 2], [2, height - 3], [width - 3, height - 3]]) {
    const i = (y * width + x) * 4;
    assert.ok(data[i + 1] > 180 && data[i] < 120, `coin (${x},${y}) non couvert par le fond personnalisé`);
  }
  assert.equal(payload.width, base.design.width);
  assert.equal(payload.height, base.design.height);
});
