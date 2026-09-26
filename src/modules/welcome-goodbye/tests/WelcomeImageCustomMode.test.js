"use strict";

/**
 * Règle produit Phase 2.2 — deux modes de carte Welcome, et seulement deux.
 *
 *   TEMPLATE STANDARD   → fond du gabarit + avatar du membre dans sa zone
 *                         circulaire + pseudo/nom + message Welcome (sous-titre)
 *   IMAGE PERSONNALISÉE → l'image de l'administrateur, rendue telle quelle,
 *                         + pseudo/nom du membre comme SEUL élément ajouté par
 *                         CIVRAT. Aucun avatar, aucun cercle, aucune zone
 *                         réservée, aucune décoration, aucun sous-titre.
 *
 * Les assertions portent sur les PIXELS du PNG réellement produit, pas sur des
 * drapeaux internes : c'est ce que l'administrateur et les membres reçoivent.
 * L'avatar de test est un magenta saturé (#ff00ff) que les fonds de gabarit et
 * les images de test ne contiennent pas : sa présence ou son absence est donc
 * sans ambiguïté.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createCanvas, loadImage } = require("@napi-rs/canvas");

const { WelcomeImageStore } = require("../services/WelcomeImageStore");
const { resolveWelcomeImageTemplate } = require("../services/welcomeImageResource");
const { WelcomeTemplateRegistry } = require("../rendering/WelcomeTemplateRegistry");
const { WelcomeResourceCache } = require("../rendering/WelcomeResourceCache");
const { WelcomeImageRenderer } = require("../image/rendering/WelcomeImageRenderer");
const { buildWelcomeCardRequest } = require("../image/pipeline/buildWelcomeCardRequest");
const { uploadWelcomeImage } = require("../interactions/welcomeImageUpload");
const { removeWelcomeImage } = require("../interactions/welcomeImageActions");
const { EntitlementDecision } = require("../../../core/entitlements");
const { WelcomeGoodbyeConfigKey: Key } = require("../configuration/welcomeGoodbyeConstants");

const GUILD_A = "111111111111111111";
const KEY_A = `${GUILD_A}/welcome.png`;
const META_KEY_A = `${GUILD_A}/welcome.json`;

const CARD_W = 1296;
const CARD_H = 292;
const AVATAR_COLOR = "#ff00ff";
const RED = { r: 170, g: 0, b: 0 };
const BLUE = { r: 0, g: 0, b: 170 };

const TEMPLATE_IDS = ["template-1", "template-2", "template-3"];

/** PNG uni, aux dimensions réelles d'une carte Welcome. */
function solidPng(color, width = CARD_W, height = CARD_H) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
  return canvas.toBuffer("image/png");
}

/**
 * Image personnalisée contenant un CERCLE GRAPHIQUE net. L'ancien détecteur le
 * confirmait sans ambiguïté : c'est le cas exigé pour prouver que CIVRAT ne
 * cherche plus ce cercle et n'y place aucun avatar.
 */
function customPngWithCircle(cx, cy, radius, fill = "#5865f2") {
  const canvas = createCanvas(CARD_W, CARD_H);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#101a2e";
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  return canvas.toBuffer("image/png");
}

function avatarPng() {
  const canvas = createCanvas(256, 256);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = AVATAR_COLOR;
  ctx.fillRect(0, 0, 256, 256);
  return canvas.toBuffer("image/png");
}

async function pixelsOf(buffer) {
  const image = await loadImage(buffer);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  return ctx.getImageData(0, 0, image.width, image.height);
}

/** Boîte couvrant un emplacement de texte, quelle que soit sa taille de police. */
function textBox(slot) {
  return {
    x0: slot.x,
    y0: Math.max(0, slot.y - slot.size - 4),
    x1: Math.min(CARD_W - 1, slot.x + 420),
    y1: Math.min(CARD_H - 1, slot.y + 6),
  };
}

function countInBox(pixels, box, matches) {
  let count = 0;
  for (let y = box.y0; y <= box.y1; y++) {
    for (let x = box.x0; x <= box.x1; x++) {
      const i = (y * pixels.width + x) * 4;
      if (matches(pixels.data[i], pixels.data[i + 1], pixels.data[i + 2])) count += 1;
    }
  }
  return count;
}

/**
 * Nombre de pixels qui DIFFÈRENT entre deux rendus dans une boîte.
 * Indépendant de la luminosité du fond et de la couleur du texte : c'est la
 * preuve la plus directe qu'un élément a (ou n'a pas) été dessiné.
 */
function countDiffering(a, b, box) {
  assert.equal(a.width, b.width);
  assert.equal(a.height, b.height);
  let count = 0;
  for (let y = box.y0; y <= box.y1; y++) {
    for (let x = box.x0; x <= box.x1; x++) {
      const i = (y * a.width + x) * 4;
      if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2]) count += 1;
    }
  }
  return count;
}

function countEverywhere(pixels, matches) {
  let count = 0;
  for (let i = 0; i < pixels.data.length; i += 4) {
    if (matches(pixels.data[i], pixels.data[i + 1], pixels.data[i + 2])) count += 1;
  }
  return count;
}

const isAvatar = (r, g, b) => r > 200 && g < 60 && b > 200;
const near = (target) => (r, g, b) => Math.abs(r - target.r) < 12 && Math.abs(g - target.g) < 12 && Math.abs(b - target.b) < 12;

// ══════════════════════════════════════════════════════════════════════════
// Harnais — le chemin réel : upload → résolution → rendu
// ══════════════════════════════════════════════════════════════════════════

function createStorageFake(seed = {}) {
  const objects = new Map(Object.entries(seed));
  const calls = [];
  return {
    calls,
    objects,
    from(name) {
      return {
        async upload(objectName, buffer) {
          calls.push({ op: "upload", bucket: name, objectName });
          objects.set(objectName, Buffer.from(buffer));
          return { error: null };
        },
        async download(objectName) {
          calls.push({ op: "download", bucket: name, objectName });
          const value = objects.get(objectName);
          return value ? { data: value, error: null } : { data: null, error: { message: "not found" } };
        },
        async remove(objectNames) {
          calls.push({ op: "remove", bucket: name, objectNames });
          for (const objectName of objectNames) objects.delete(objectName);
          return { error: null };
        },
      };
    },
  };
}

function createSettingsFake(initial = {}) {
  const store = new Map(Object.entries(initial));
  const updates = [];
  return {
    updates,
    async get(guildId) {
      return {
        language: "fr",
        [Key.WELCOME_IMAGE_ENABLED]: false,
        [Key.WELCOME_TEMPLATE]: "template-1",
        [Key.WELCOME_IMAGE_KEY]: null,
        ...(store.get(guildId) || {}),
      };
    },
    async update(guildId, patch) {
      updates.push({ guildId, patch });
      store.set(guildId, { ...(store.get(guildId) || {}), ...patch });
      return this.get(guildId);
    },
  };
}

function createTransportFake() {
  const calls = [];
  return {
    calls,
    async reply(payload) { calls.push({ kind: "reply", content: payload?.view?.content }); return {}; },
    async update(payload) { calls.push({ kind: "update", content: payload?.view?.content }); return {}; },
    async replyImagePreview(payload) { calls.push({ kind: "imagePreview", content: payload?.content }); return {}; },
  };
}

function createLogger() {
  const logs = [];
  return { logs, warn: (m, c) => logs.push({ level: "warn", message: m, ...c }), info: (m, c) => logs.push({ level: "info", message: m, ...c }) };
}

/** Sert le buffer attendu par le téléchargement de la pièce jointe. */
async function withFetch(buffer, run) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  });
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

function scenario({ seed = {}, templateId = "template-1" } = {}) {
  const storage = createStorageFake(seed);
  const imageStore = new WelcomeImageStore({ storage });
  const settings = createSettingsFake({ [Key.WELCOME_TEMPLATE]: templateId });
  const entitlementService = {
    async requireFeature() { return { ok: true, granted: true, code: EntitlementDecision.GRANTED }; },
  };
  const registry = new WelcomeTemplateRegistry();
  registry.discover();
  const renderer = new WelcomeImageRenderer({ avatarLoader: async () => avatarPng() });
  const resourceCache = new WelcomeResourceCache();
  const transport = createTransportFake();
  const logger = createLogger();

  return {
    storage,
    imageStore,
    settings,
    logger,
    transport,

    async upload(buffer) {
      return withFetch(buffer, () => uploadWelcomeImage({
        guildId: GUILD_A,
        userId: "999999999999999999",
        t: (key) => key,
        envelope: {
          transport,
          discordMember: null,
          attachmentSizeLimit: 10 * 1024 * 1024,
          options: {
            getAttachment: () => ({ contentType: "image/png", size: buffer.length, url: "https://cdn/x.png", name: "welcome.png" }),
          },
        },
        settings,
        imageStore,
        imagePipeline: null,
        templateRegistry: null,
        resourceCache: null,
        adminLogService: { record: () => {} },
        entitlementService,
        logger,
      }));
    },

    async remove() {
      return removeWelcomeImage({
        guildId: GUILD_A,
        userId: "999999999999999999",
        t: (key) => key,
        envelope: { transport },
        settings,
        imageStore,
        logger,
      });
    },

    /** Rend la carte exactement comme la livraison le fait. */
    async render({ title = "Alice", subtitle = "Welcome to the server" } = {}) {
      const config = await settings.get(GUILD_A);
      const baseTemplate = registry.get(config[Key.WELCOME_TEMPLATE]) || registry.get("template-1");
      const template = await resolveWelcomeImageTemplate({
        baseTemplate,
        config,
        guildId: GUILD_A,
        entitlement: { ok: true, granted: true, code: EntitlementDecision.GRANTED },
        imageStore,
        resourceCache,
        logger,
      });
      const request = buildWelcomeCardRequest({
        // `username` suit `title` : `buildWelcomeCardRequest` résout
        // `displayName || username`, donc un titre vide retomberait sinon sur
        // le pseudo et le contrôle « sans texte » mesurerait du texte.
        member: { guildId: GUILD_A, userId: "u", username: title, displayName: title, avatarUrl: "http://x/a.png" },
        subtitleText: subtitle,
        template,
      });
      const payload = await renderer.render(request, template);
      return { template, pixels: await pixelsOf(payload.buffer) };
    },
  };
}

// ══════════════════════════════════════════════════════════════════════════
// A. Templates standards — avatar + pseudo/nom, inchangés
// ══════════════════════════════════════════════════════════════════════════

for (const templateId of TEMPLATE_IDS) {
  test(`Template standard ${templateId} — avatar du membre rendu dans sa zone`, async () => {
    const s = scenario({ templateId });
    const { template, pixels } = await s.render();

    assert.notEqual(template.design.customImage, true, "un gabarit standard n'est pas en mode image personnalisée");
    assert.ok(template.design.avatar, "un gabarit standard déclare une zone avatar");

    const { cx, cy, radius } = template.design.avatar;
    assert.ok(countInBox(pixels, { x0: cx - 2, y0: cy - 2, x1: cx + 2, y1: cy + 2 }, isAvatar) > 0,
      "l'avatar doit être dessiné au centre de la zone du gabarit");
    // Et il doit couvrir le disque, pas seulement son centre.
    assert.ok(countInBox(pixels, { x0: cx - 2, y0: cy - Math.round(radius * 0.7), x1: cx + 2, y1: cy - Math.round(radius * 0.7) + 4 }, isAvatar) > 0,
      "le disque avatar doit être rempli, pas seulement son centre");
  });

  test(`Template standard ${templateId} — pseudo/nom rendu, sous-titre absent`, async () => {
    const s = scenario({ templateId });
    const design = (await s.render()).template.design;

    const withText = (await s.render({ title: "Alice", subtitle: "Welcome to the server" })).pixels;
    // Contrôle différentiel : le même gabarit rendu sans aucun texte. La
    // comparaison est indépendante du fond du gabarit et de la couleur choisie
    // par le gabarit pour chaque emplacement.
    const withoutText = (await s.render({ title: "", subtitle: "" })).pixels;

    assert.ok(countDiffering(withText, withoutText, textBox(design.title)) > 0,
      "le pseudo/nom doit être dessiné dans la zone du titre");
    // Le message Welcome n'est plus JAMAIS dessiné dans l'image, même en mode
    // standard : il part uniquement dans le contenu du message Discord.
    assert.equal(countDiffering(withText, withoutText, textBox(design.subtitle)), 0,
      "le sous-titre ne doit PAS être dessiné, même en mode standard");
  });
}

// ══════════════════════════════════════════════════════════════════════════
// B. Image personnalisée — l'image de l'admin + le pseudo/nom, rien d'autre
// ══════════════════════════════════════════════════════════════════════════

test("Image personnalisée — aucun avatar n'est dessiné, même quand Discord en fournit un", async () => {
  const s = scenario();
  const uploaded = await s.upload(solidPng("#001122"));
  assert.equal(uploaded.ok, true, `upload refusé : ${uploaded.code}`);

  const { template, pixels } = await s.render();
  assert.equal(template.design.customImage, true, "le mode image personnalisée doit être actif");
  assert.equal(template.design.avatar, null, "aucune zone avatar ne doit être dérivée");
  assert.equal(countEverywhere(pixels, isAvatar), 0,
    "aucun pixel d'avatar ne doit apparaître, alors que l'avatarLoader répond");
});

test("Image personnalisée — le pseudo/nom est rendu, le sous-titre ne l'est pas", async () => {
  const s = scenario();
  await s.upload(solidPng("#000000"));
  const design = (await s.render()).template.design;

  const full = (await s.render({ title: "Alice", subtitle: "Welcome to the server" })).pixels;
  const noSubtitle = (await s.render({ title: "Alice", subtitle: "" })).pixels;
  const noTitle = (await s.render({ title: "", subtitle: "Welcome to the server" })).pixels;

  // Le pseudo/nom est bien dessiné : retirer le titre modifie sa zone.
  assert.ok(countDiffering(full, noTitle, textBox(design.title)) > 0,
    "le pseudo/nom doit être dessiné sur l'image personnalisée");
  // Le sous-titre n'est PAS dessiné : retirer son contenu ne change strictement
  // rien à l'image produite.
  assert.equal(countDiffering(full, noSubtitle, textBox(design.subtitle)), 0,
    "le sous-titre ne doit PAS être dessiné sur une image personnalisée");
});

test("Image personnalisée — le fond n'est ni déformé ni modifié", async () => {
  const s = scenario();
  // Rouge uni : après un recadrage « cover » 1:1 (mêmes dimensions), chaque
  // pixel de la carte doit être ce rouge, hors texte.
  await s.upload(solidPng("#aa0000"));
  const { pixels } = await s.render({ title: "", subtitle: "" });
  assert.equal(countEverywhere(pixels, near(RED)), pixels.width * pixels.height,
    "toute la carte doit être le rouge de l'image, sans recadrage déformant");
});

test("Image personnalisée contenant un CERCLE GRAPHIQUE — CIVRAT ne le détecte pas et n'y place aucun avatar", async () => {
  const s = scenario();
  // Cercle net au centre droit : l'ancien détecteur le confirmait.
  await s.upload(customPngWithCircle(1000, 146, 110));
  assert.equal(s.storage.objects.has(META_KEY_A), false, "aucun sidecar de géométrie ne doit être écrit");

  const { template, pixels } = await s.render();
  assert.equal(template.design.avatar, null, "aucune zone avatar dérivée du cercle présent dans l'image");
  assert.equal(countEverywhere(pixels, isAvatar), 0, "aucun avatar ne doit être placé sur le cercle de l'image");

  // Le cercle dessiné par l'administrateur doit rester intact au centre.
  const at = (x, y) => {
    const i = (y * pixels.width + x) * 4;
    return [pixels.data[i], pixels.data[i + 1], pixels.data[i + 2]];
  };
  assert.deepEqual(at(1000, 146), [0x58, 0x65, 0xf2], "le cercle de l'image doit rester visible");
});

test("Image personnalisée — un welcome.json hérité de la Phase 2.1 ne provoque aucun rendu avec avatar", async () => {
  const legacy = { version: 1, verdict: "CONFIRME", avatar: { cx: 1000, cy: 146, radius: 110 } };
  const s = scenario({ seed: { [KEY_A]: customPngWithCircle(1000, 146, 110), [META_KEY_A]: Buffer.from(JSON.stringify(legacy), "utf8") } });
  // La guilde a déjà une image configurée : c'est le cas « ancien custom +
  // ancien welcome.json » que la règle produit exige de rendre inerte.
  await s.settings.update(GUILD_A, { [Key.WELCOME_IMAGE_KEY]: KEY_A });

  const { template, pixels } = await s.render();
  assert.equal(template.design.customImage, true);
  assert.equal(template.design.avatar, null, "le sidecar hérité ne doit plus influencer le rendu");
  assert.equal(countEverywhere(pixels, isAvatar), 0, "aucun avatar ne doit être rendu");
});

// ══════════════════════════════════════════════════════════════════════════
// C. Remplacement A → B — B immédiatement, jamais A, jamais d'avatar
// ══════════════════════════════════════════════════════════════════════════

test("Remplacement A → B — la seconde carte montre B + pseudo/nom, jamais A ni avatar", async () => {
  const s = scenario();

  const uploadedA = await s.upload(solidPng("#aa0000"));
  assert.equal(uploadedA.ok, true, `upload A refusé : ${uploadedA.code}`);
  const cardA = await s.render({ title: "Alice" });
  assert.equal(countEverywhere(cardA.pixels, near(RED)) > 0, true, "précondition : la carte A est rouge");
  assert.equal(countEverywhere(cardA.pixels, isAvatar), 0, "aucun avatar sur A");

  // Remplacement immédiat, avec le MÊME cache : c'est le correctif de la
  // Phase 2.1 qui doit permettre de voir B sans attendre le TTL.
  const uploadedB = await s.upload(solidPng("#0000aa"));
  assert.equal(uploadedB.ok, true, `upload B refusé : ${uploadedB.code}`);
  const cardB = await s.render({ title: "Alice" });

  assert.equal(countEverywhere(cardB.pixels, near(BLUE)) > 0, true, "la seconde carte doit montrer B");
  assert.equal(countEverywhere(cardB.pixels, near(RED)), 0, "A ne doit plus apparaître");
  assert.equal(countEverywhere(cardB.pixels, isAvatar), 0, "aucun avatar ne doit être ajouté à B");

  const design = cardB.template.design;
  const cardBNoSubtitle = await s.render({ title: "Alice", subtitle: "" });
  const cardBNoTitle = await s.render({ title: "", subtitle: "Welcome to the server" });
  assert.ok(countDiffering(cardB.pixels, cardBNoTitle.pixels, textBox(design.title)) > 0,
    "le pseudo/nom doit rester sur B");
  assert.equal(countDiffering(cardB.pixels, cardBNoSubtitle.pixels, textBox(design.subtitle)), 0,
    "aucun sous-titre ne doit être ajouté sur B");
});

// ══════════════════════════════════════════════════════════════════════════
// D. Suppression — retour au template standard, avec avatar
// ══════════════════════════════════════════════════════════════════════════

test("Suppression de l'image personnalisée — le template standard revient avec avatar + pseudo/nom", async () => {
  const s = scenario();
  await s.upload(solidPng("#001122"));
  const custom = await s.render();
  assert.equal(custom.template.design.customImage, true, "précondition : mode image personnalisée actif");

  const removal = await s.remove();
  assert.equal(removal.removed, true);
  assert.equal(s.storage.objects.has(KEY_A), false, "l'objet doit être retiré du bucket");
  assert.equal(s.storage.objects.has(META_KEY_A), false, "aucun sidecar orphelin ne doit subsister");

  const { template, pixels } = await s.render();
  assert.notEqual(template.design.customImage, true, "le rendu doit être repassé en mode standard");
  assert.ok(template.design.avatar, "le gabarit standard déclare une zone avatar");

  const { cx, cy } = template.design.avatar;
  assert.ok(countInBox(pixels, { x0: cx - 2, y0: cy - 2, x1: cx + 2, y1: cy + 2 }, isAvatar) > 0,
    "l'avatar doit être de nouveau dessiné");
  const withoutName = await s.render({ title: "" });
  assert.ok(countDiffering(pixels, withoutName.pixels, textBox(template.design.title)) > 0,
    "le pseudo/nom doit être dessiné");
});
