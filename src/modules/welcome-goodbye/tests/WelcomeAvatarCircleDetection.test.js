"use strict";

/**
 * Détection automatique de la zone avatar — module conservé, chemin désactivé.
 *
 * PHASE 2.2 : la règle produit a changé. Une image Welcome personnalisée est
 * rendue TELLE QUELLE, avec pour seul élément ajouté par CIVRAT le pseudo/nom
 * du membre. CIVRAT ne détecte plus de cercle, ne dérive plus de zone avatar et
 * ne dessine plus l'avatar du membre sur une image personnalisée.
 *
 * Ce fichier couvre donc deux choses distinctes :
 *  A/B. le module `detectAvatarCircle` et l'API sidecar de `WelcomeImageStore`,
 *       qui restent dans le dépôt et doivent continuer à fonctionner ;
 *  C/D/E. la PREUVE que le chemin personnalisé ne passe plus par eux : aucune
 *       détection à l'upload, aucune géométrie dérivée, aucun avatar rendu, et
 *       un `welcome.json` hérité de la Phase 2.1 sans aucun effet sur le rendu.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createCanvas, loadImage } = require("@napi-rs/canvas");

const { detectAvatarCircle, AvatarCircleVerdict } = require("../image/analysis/detectAvatarCircle");
const { WelcomeImageStore } = require("../services/WelcomeImageStore");
const { resolveWelcomeImageTemplate } = require("../services/welcomeImageResource");
const { uploadWelcomeImage } = require("../interactions/welcomeImageUpload");
const {
  buildWelcomeImageMetaKey,
  isWelcomeImageMetaKey,
  isDiscordGuildId,
} = require("../configuration/welcomeImageStorage");
const { WelcomeTemplateRegistry } = require("../rendering/WelcomeTemplateRegistry");
const { WelcomeGoodbyeConfigKey: Key } = require("../configuration/welcomeGoodbyeConstants");
const { EntitlementDecision } = require("../../../core/entitlements");

const GUILD_A = "111111111111111111";
const GUILD_B = "222222222222222222";
const IMAGE_KEY_A = `${GUILD_A}/welcome.png`;
const META_KEY_A = `${GUILD_A}/welcome.json`;

// Carte aux proportions réelles d'un gabarit Welcome.
const CARD_W = 1296;
const CARD_H = 292;

/** Image Welcome synthétique contenant un disque net à l'endroit indiqué. */
function welcomeImageWithCircle(cx, cy, radius, { fill = "#5865f2", background = "#101a2e", text = null } = {}) {
  const canvas = createCanvas(CARD_W, CARD_H);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  if (text) {
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 64px sans-serif";
    ctx.fillText(text, 420, 170);
  }
  return canvas.toBuffer("image/png");
}

function plainWelcomeImage() {
  const canvas = createCanvas(CARD_W, CARD_H);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#101a2e";
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.fillStyle = "#1d2b45";
  ctx.fillRect(80, 60, 400, 170);
  return canvas.toBuffer("image/png");
}

function smallPng(width = 40, height = 20, color = "#112233") {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
  return canvas.toBuffer("image/png");
}

// ── Doublures ────────────────────────────────────────────────────────────────

/**
 * Erreur à la forme réelle de `@supabase/storage-js` (StorageApiError) : elle
 * porte `status`, `statusCode` et `message`, et surtout AUCUN champ `code`.
 * Les fakes qui inventaient un `code` masquaient justement le bug de log.
 */
function storageApiError(status, message) {
  return { name: "StorageApiError", status, statusCode: String(status), message };
}

function createStorageFake(seed = {}, options = {}) {
  const objects = new Map(Object.entries(seed));
  const calls = [];
  return {
    calls,
    objects,
    from(name) {
      return {
        async upload(objectName, buffer, opts = {}) {
          calls.push({ op: "upload", bucket: name, objectName, options: opts });
          if (options.failUploadOn === objectName) return { error: { message: "row-level security blocks write" } };
          // `allowedMimeTypes` simule un bucket dont la liste de types est
          // restreinte : l'image passe, le sidecar JSON est rejeté en 400.
          if (Array.isArray(options.allowedMimeTypes)
            && !options.allowedMimeTypes.includes(String(opts.contentType))) {
            return { error: storageApiError(400, `Invalid mimetype: ${opts.contentType}`) };
          }
          if (options.rejectUploadStatus && options.rejectUploadOn === objectName) {
            return { error: storageApiError(options.rejectUploadStatus, options.rejectUploadMessage || "rejected") };
          }
          objects.set(objectName, Buffer.from(buffer));
          return { error: null };
        },
        async download(objectName) {
          calls.push({ op: "download", bucket: name, objectName });
          if (options.failDownloadOn === objectName) throw new Error("network down");
          const value = objects.get(objectName);
          return value ? { data: value, error: null } : { data: null, error: { message: "not found" } };
        },
        async remove(objectNames) {
          calls.push({ op: "remove", bucket: name, objectNames });
          if (options.failRemoveOn && objectNames.includes(options.failRemoveOn)) {
            return { error: { message: "row-level security blocks delete" } };
          }
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

function createEntitlementFake({ granted = true, code = null } = {}) {
  return {
    async requireFeature() {
      return { ok: granted, granted, code: code || (granted ? EntitlementDecision.GRANTED : EntitlementDecision.PREMIUM_REQUIRED) };
    },
  };
}

function createTransportFake() {
  const calls = [];
  return {
    calls,
    async reply(payload, { ephemeral = false } = {}) {
      calls.push({ kind: "reply", content: payload?.view?.content, ephemeral });
      return {};
    },
    async replyImagePreview(payload) {
      calls.push({ kind: "imagePreview", content: payload?.content, bytes: payload?.image?.buffer?.length ?? payload?.buffer?.length ?? null });
      return {};
    },
  };
}

function createLogger() {
  const logs = [];
  return { logs, warn: (m, c) => logs.push({ level: "warn", message: m, ...c }), info: (m, c) => logs.push({ level: "info", message: m, ...c }) };
}

function baseTemplate() {
  const registry = new WelcomeTemplateRegistry();
  registry.discover();
  return registry.get("template-1");
}

function uploadContext(overrides = {}) {
  const transport = overrides.transport || createTransportFake();
  const settings = overrides.settings || createSettingsFake();
  const imageStore = overrides.imageStore || new WelcomeImageStore({ storage: createStorageFake() });
  const logger = overrides.logger || createLogger();
  const attachment = overrides.attachment || null;
  const attachmentSizeLimit = overrides.attachmentSizeLimit || 10 * 1024 * 1024;
  return {
    guildId: GUILD_A,
    userId: "999999999999999999",
    t: (key) => key,
    // Le handler lit la pièce jointe via envelope.options.getAttachment("image")
    // et la limite via envelope.attachmentSizeLimit : le harnais reproduit
    // exactement ce contrat.
    envelope: {
      transport,
      discordMember: null,
      attachmentSizeLimit,
      options: { getAttachment: () => attachment },
    },
    settings,
    imageStore,
    imagePipeline: null,
    templateRegistry: null,
    resourceCache: null,
    adminLogService: { record: () => {} },
    entitlementService: createEntitlementFake(),
    logger,
  };
}

function attachmentFor(buffer, contentType = "image/png") {
  return { contentType, size: buffer.length, url: "https://cdn/welcome.png", name: "welcome.png" };
}

/** Sert le buffer attendu par le téléchargement, le temps d'un test. */
async function withFetch(buffer, run) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) });
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

// ══════════════════════════════════════════════════════════════════════════
// A. Détection — les trois verdicts
// ══════════════════════════════════════════════════════════════════════════

test("Détection — un cercle net à gauche donne CONFIRME avec la bonne géométrie", async () => {
  const result = await detectAvatarCircle(welcomeImageWithCircle(216, 146, 120), { guildId: GUILD_A });
  assert.equal(result.verdict, AvatarCircleVerdict.CONFIRMED);
  assert.ok(result.geometry, "une géométrie doit être proposée");
  assert.ok(Math.hypot(result.geometry.cx - 216, result.geometry.cy - 146) <= 12, `centre détecté ${result.geometry.cx},${result.geometry.cy}`);
  assert.ok(Math.abs(result.geometry.radius - 120) <= 12, `rayon détecté ${result.geometry.radius}`);
});

test("Détection — la position du cercle est suivie (gauche, centre, droite)", async () => {
  for (const cx of [216, 648, 1080]) {
    const result = await detectAvatarCircle(welcomeImageWithCircle(cx, 146, 118), { guildId: GUILD_A });
    assert.equal(result.verdict, AvatarCircleVerdict.CONFIRMED, `cercle en x=${cx} non confirmé`);
    assert.ok(Math.abs(result.geometry.cx - cx) <= 12, `x=${cx} : détecté ${result.geometry.cx}`);
  }
});

test("Détection — la géométrie est exprimée en coordonnées d'origine, pas de travail", async () => {
  // L'image de travail est réduite à 400 px ; sans remise à l'échelle le rayon
  // détecté serait d'environ 36 au lieu de 120.
  const result = await detectAvatarCircle(welcomeImageWithCircle(216, 146, 120), { guildId: GUILD_A });
  assert.ok(result.geometry.radius > 100, `rayon ${result.geometry.radius} : la remise à l'échelle a échoué`);
  assert.ok(result.detail.workingWidth <= 400, "l'image de travail doit rester bornée");
});

test("Détection — plusieurs cercles identiques donnent AMBIGU et AUCUNE géométrie", async () => {
  const canvas = createCanvas(CARD_W, CARD_H);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#101a2e";
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  for (const [cx, fill] of [[216, "#5865f2"], [648, "#eb459e"], [1080, "#3ba55d"]]) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(cx, 146, 118, 0, Math.PI * 2);
    ctx.fill();
  }
  const result = await detectAvatarCircle(canvas.toBuffer("image/png"), { guildId: GUILD_A });
  assert.equal(result.verdict, AvatarCircleVerdict.AMBIGUOUS);
  assert.equal(result.geometry, null, "une géométrie incertaine ne doit JAMAIS être proposée");
});

test("Détection — une image sans cercle donne AUCUN et aucune géométrie", async () => {
  const result = await detectAvatarCircle(plainWelcomeImage(), { guildId: GUILD_A });
  assert.equal(result.verdict, AvatarCircleVerdict.NONE);
  assert.equal(result.geometry, null);
});

test("Détection — un rectangle arrondi n'est pas pris pour un cercle", async () => {
  const canvas = createCanvas(CARD_W, CARD_H);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#101a2e";
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.fillStyle = "#5865f2";
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(96, 26, 240, 240, 48); else ctx.rect(96, 26, 240, 240);
  ctx.fill();
  const result = await detectAvatarCircle(canvas.toBuffer("image/png"), { guildId: GUILD_A });
  assert.equal(result.verdict, AvatarCircleVerdict.NONE);
  assert.equal(result.geometry, null);
});

test("Détection — la présence de texte ne détourne pas la détection", async () => {
  const result = await detectAvatarCircle(welcomeImageWithCircle(216, 146, 120, { text: "Bienvenue" }), { guildId: GUILD_A });
  assert.equal(result.verdict, AvatarCircleVerdict.CONFIRMED);
  assert.ok(Math.abs(result.geometry.cx - 216) <= 12, `x détecté ${result.geometry.cx}`);
});

test("Détection — ne lève jamais, même sur une entrée invalide", async () => {
  for (const bad of [null, undefined, Buffer.alloc(0), Buffer.from("pas une image"), 42, {}]) {
    const result = await detectAvatarCircle(bad, { guildId: GUILD_A });
    assert.equal(result.verdict, AvatarCircleVerdict.NONE, `entrée ${typeof bad} : verdict inattendu`);
    assert.equal(result.geometry, null);
  }
});

test("Détection — les fonds de gabarit livrés retrouvent leur géométrie déclarée", async () => {
  // Le test le plus probant : trois images de production réelles, jamais
  // utilisées pour ajuster les seuils. Le détecteur doit y retrouver, à
  // l'aveugle, la zone que le concepteur a déclarée dans `template.json`.
  // Si les seuils dérivent un jour, ce test casse.
  const fs = require("node:fs");
  const path = require("node:path");
  const templatesDir = path.join(__dirname, "..", "templates");
  const registry = new WelcomeTemplateRegistry();
  registry.discover();

  let checked = 0;
  for (const entry of fs.readdirSync(templatesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(templatesDir, entry.name, "background.png");
    const manifestPath = path.join(templatesDir, entry.name, "template.json");
    if (!fs.existsSync(file) || !fs.existsSync(manifestPath)) continue;
    const declared = JSON.parse(fs.readFileSync(manifestPath, "utf8")).design.avatar;

    const result = await detectAvatarCircle(fs.readFileSync(file), { guildId: GUILD_A });
    assert.equal(result.verdict, AvatarCircleVerdict.CONFIRMED, `${entry.name} : zone avatar non reconnue`);
    const drift = Math.hypot(result.geometry.cx - declared.cx, result.geometry.cy - declared.cy);
    assert.ok(drift <= 12, `${entry.name} : centre à ${drift.toFixed(1)} px du déclaré`);
    assert.ok(Math.abs(result.geometry.radius - declared.radius) <= 12,
      `${entry.name} : rayon ${result.geometry.radius} contre ${declared.radius} déclaré`);
    checked++;
  }
  assert.ok(checked >= 3, `fonds de gabarit introuvables (${checked} testé(s))`);
});

// ══════════════════════════════════════════════════════════════════════════
// B. Sidecar de métadonnées
// ══════════════════════════════════════════════════════════════════════════

test("Sidecar — la clé est dérivée du guildId et refuse toute traversée", () => {
  assert.equal(buildWelcomeImageMetaKey(GUILD_A), META_KEY_A);
  assert.equal(isWelcomeImageMetaKey(META_KEY_A), true);
  assert.equal(isWelcomeImageMetaKey(IMAGE_KEY_A), false, "la clé image n'est pas une clé meta");
  for (const forged of ["../etc/welcome.json", `${GUILD_A}/autre.json`, "autre/welcome.json", "42"]) {
    assert.equal(isWelcomeImageMetaKey(forged), false, `${forged} devrait être refusée`);
  }
  assert.throws(() => buildWelcomeImageMetaKey("../etc"), TypeError);
  assert.equal(isDiscordGuildId(GUILD_A), true);
});

test("Sidecar — écriture et lecture aller-retour dans le même bucket privé", async () => {
  const storage = createStorageFake();
  const store = new WelcomeImageStore({ storage });
  const meta = { version: 1, verdict: "CONFIRME", avatar: { cx: 216, cy: 146, radius: 120 } };

  assert.equal(await store.uploadMeta(GUILD_A, meta), true);
  const upload = storage.calls.find((call) => call.op === "upload");
  assert.equal(upload.bucket, "civrat-welcome-images", "le sidecar reste dans le bucket privé");
  assert.equal(upload.objectName, META_KEY_A);
  assert.equal(upload.options.contentType, "application/json");
  assert.equal(upload.options.upsert, true);

  assert.deepEqual(await store.downloadMeta(GUILD_A), meta);
});

test("Sidecar — un JSON corrompu renvoie null au lieu de lever", async () => {
  const storage = createStorageFake({ [META_KEY_A]: Buffer.from("{ pas du json", "utf8") });
  const store = new WelcomeImageStore({ storage });
  assert.equal(await store.downloadMeta(GUILD_A), null);
});

test("Sidecar — un échec d'écriture ne lève pas (l'upload ne doit pas échouer)", async () => {
  const storage = createStorageFake({}, { failUploadOn: META_KEY_A });
  const store = new WelcomeImageStore({ storage });
  assert.equal(await store.uploadMeta(GUILD_A, { verdict: "CONFIRME" }), false, "échec signalé par false, pas par exception");
});

test("Sidecar — absent ou backend indisponible : null, jamais d'exception", async () => {
  assert.equal(await new WelcomeImageStore({ storage: createStorageFake() }).downloadMeta(GUILD_A), null);
  assert.equal(await new WelcomeImageStore().downloadMeta(GUILD_A), null);
  assert.equal(await new WelcomeImageStore().uploadMeta(GUILD_A, {}), false);
});

test("Sidecar — la suppression retire l'image ET les métadonnées ensemble", async () => {
  const storage = createStorageFake({
    [IMAGE_KEY_A]: smallPng(),
    [META_KEY_A]: Buffer.from("{}", "utf8"),
  });
  const store = new WelcomeImageStore({ storage });
  assert.equal(await store.remove(GUILD_A), true);
  assert.equal(storage.objects.has(IMAGE_KEY_A), false, "l'image doit partir");
  assert.equal(storage.objects.has(META_KEY_A), false, "une géométrie orpheline pourrait s'appliquer à l'image suivante");
});

// ══════════════════════════════════════════════════════════════════════════
// B2. Écriture du sidecar — succès, échec, diagnostic et repli
// ══════════════════════════════════════════════════════════════════════════

function collectLogger() {
  const entries = [];
  return {
    entries,
    warn: (message, data) => entries.push({ level: "warn", message, data }),
    info: (message, data) => entries.push({ level: "info", message, data }),
    find: (message) => entries.filter((entry) => entry.message === message),
  };
}

const META = Object.freeze({
  version: 1,
  verdict: "CONFIRME",
  score: 0.752,
  avatar: { cx: 216, cy: 152, radius: 109 },
  detectedAt: "2026-09-20T00:00:00.000Z",
});

test("uploadMeta — succès : bucket privé, clé dérivée, octets exacts", async () => {
  const storage = createStorageFake();
  const logger = collectLogger();
  const store = new WelcomeImageStore({ storage, logger });

  assert.equal(await store.uploadMeta(GUILD_A, META), true);

  const uploads = storage.calls.filter((call) => call.op === "upload");
  assert.equal(uploads.length, 1, "un seul essai quand le type exact est accepté");
  assert.equal(uploads[0].bucket, "civrat-welcome-images");
  assert.equal(uploads[0].objectName, META_KEY_A);
  assert.equal(uploads[0].options.contentType, "application/json");
  assert.equal(uploads[0].options.upsert, true);

  const stored = storage.objects.get(META_KEY_A);
  assert.deepEqual(JSON.parse(stored.toString("utf8")), META, "les octets écrits sont bien la géométrie");
  assert.deepEqual(await store.downloadMeta(GUILD_A), META, "aller-retour");
  assert.deepEqual(logger.find("Welcome image meta upload rejected"), [], "aucun avertissement sur un succès");
});

test("uploadMeta — bucket restreint aux images : le repli de content type écrit quand même le sidecar", async () => {
  // Cas de production le plus probable : `allowed_mime_types` limité aux
  // images. L'image passe, `application/json` est refusé en 400.
  const storage = createStorageFake({}, { allowedMimeTypes: ["image/png", "image/jpeg"] });
  const logger = collectLogger();
  const store = new WelcomeImageStore({ storage, logger });

  assert.equal(await store.uploadMeta(GUILD_A, META), true, "le sidecar doit être écrit malgré le refus du type exact");
  assert.deepEqual(JSON.parse(storage.objects.get(META_KEY_A).toString("utf8")), META);
  assert.deepEqual(await store.downloadMeta(GUILD_A), META, "le type déclaré n'affecte pas la relecture");

  const fallback = logger.find("Welcome image meta stored with fallback content type");
  assert.equal(fallback.length, 1, "l'administrateur doit voir que le type exact a été refusé");
  assert.equal(fallback[0].data.rejectedContentType, "application/json");
  assert.equal(fallback[0].data.status, 400, "la cause réelle du refus est journalisée");
});

test("uploadMeta — refus RLS (403) : échec immédiat, sans retry, avec la cause réelle", async () => {
  const storage = createStorageFake({}, {
    rejectUploadOn: META_KEY_A,
    rejectUploadStatus: 403,
    rejectUploadMessage: 'new row violates row-level security policy for table "objects"',
  });
  const logger = collectLogger();
  const store = new WelcomeImageStore({ storage, logger });

  assert.equal(await store.uploadMeta(GUILD_A, META), false);
  assert.equal(storage.calls.filter((call) => call.op === "upload").length, 1, "un 403 ne se corrige pas par un autre content type");
  assert.equal(storage.objects.has(META_KEY_A), false);

  const rejection = logger.find("Welcome image meta upload rejected");
  assert.equal(rejection.length, 1);
  assert.equal(rejection[0].data.status, 403);
  assert.equal(rejection[0].data.statusCode, "403");
  assert.match(rejection[0].data.errorMessage, /row-level security/);
});

test("uploadMeta — panne 5xx : échec immédiat, sans retry", async () => {
  const storage = createStorageFake({}, { rejectUploadOn: META_KEY_A, rejectUploadStatus: 500, rejectUploadMessage: "Internal Server Error" });
  const store = new WelcomeImageStore({ storage, logger: collectLogger() });

  assert.equal(await store.uploadMeta(GUILD_A, META), false);
  assert.equal(storage.calls.filter((call) => call.op === "upload").length, 1);
});

test("uploadMeta — le journal n'est jamais aveugle : status et statusCode remplacent le code:null", async () => {
  // C'est le cœur du correctif : les erreurs Storage n'ont PAS de champ `code`.
  // Avant, TOUTES les causes journalisaient `{ code: null }` et le diagnostic
  // était impossible. Chaque site doit exposer status / statusCode / message.
  const cases = [
    { name: "403 RLS", options: { rejectUploadOn: META_KEY_A, rejectUploadStatus: 403 }, status: 403 },
    { name: "500 panne", options: { rejectUploadOn: META_KEY_A, rejectUploadStatus: 500 }, status: 500 },
  ];
  for (const testCase of cases) {
    const logger = collectLogger();
    const store = new WelcomeImageStore({ storage: createStorageFake({}, testCase.options), logger });
    assert.equal(await store.uploadMeta(GUILD_A, META), false, testCase.name);

    const final = logger.find("Welcome image meta not stored");
    assert.equal(final.length, 1, `${testCase.name} : un avertissement final est émis`);
    assert.equal(final[0].data.status, testCase.status, `${testCase.name} : le statut HTTP est journalisé`);
    assert.equal(final[0].data.statusCode, String(testCase.status));
    assert.equal(final[0].data.errorName, "StorageApiError");
    assert.notEqual(final[0].data.errorMessage, null, `${testCase.name} : le message serveur est conservé`);
    assert.equal("code" in final[0].data, false, "le champ code:null inexploitable a disparu");
  }
});

test("uploadMeta — une erreur sans statut ne déclenche pas de retry inutile", async () => {
  const storage = createStorageFake({}, { failUploadOn: META_KEY_A });
  const store = new WelcomeImageStore({ storage, logger: collectLogger() });
  assert.equal(await store.uploadMeta(GUILD_A, META), false);
  assert.equal(storage.calls.filter((call) => call.op === "upload").length, 1, "pas de matraquage d'un backend en échec");
});

test("removeMeta — retire le sidecar sans toucher à l'image", async () => {
  const storage = createStorageFake({ [IMAGE_KEY_A]: smallPng(), [META_KEY_A]: Buffer.from("{}", "utf8") });
  const store = new WelcomeImageStore({ storage });

  assert.equal(await store.removeMeta(GUILD_A), true);
  assert.equal(storage.objects.has(META_KEY_A), false, "le sidecar est parti");
  assert.equal(storage.objects.has(IMAGE_KEY_A), true, "l'image doit rester en place");
});

test("removeMeta — un sidecar déjà absent est un succès, pas un incident", async () => {
  const logger = collectLogger();
  const storage = createStorageFake();
  const store = new WelcomeImageStore({ storage, logger });
  assert.equal(await store.removeMeta(GUILD_A), true);
  assert.deepEqual(logger.find("Welcome image meta removal rejected"), []);
});

test("isolation — le sidecar d'une guilde ne se lit ni ne s'écrit depuis une autre", async () => {
  const storage = createStorageFake({ [META_KEY_A]: Buffer.from(JSON.stringify(META), "utf8") });
  const store = new WelcomeImageStore({ storage });

  assert.deepEqual(await store.downloadMeta(GUILD_A), META);
  assert.equal(await store.downloadMeta(GUILD_B), null, "la guilde B ne voit pas la géométrie de A");
  assert.equal(await store.removeMeta(GUILD_B), true);
  assert.equal(storage.objects.has(META_KEY_A), true, "la purge de B ne touche pas A");
  assert.throws(() => store.metaKeyFor("../etc"), TypeError);
});

// ══════════════════════════════════════════════════════════════════════════
// C. Rendu — Phase 2.2 : une image personnalisée n'a AUCUNE zone avatar
// ══════════════════════════════════════════════════════════════════════════

function metaSidecar(geometry, verdict = "CONFIRME") {
  return Buffer.from(JSON.stringify({ version: 1, verdict, avatar: geometry }), "utf8");
}

/** Résout le template de rendu avec une image personnalisée déjà en bucket. */
async function resolveCustom(objects, guildId = GUILD_A, imageStore = null) {
  const store = imageStore || new WelcomeImageStore({ storage: createStorageFake(objects) });
  return resolveWelcomeImageTemplate({
    baseTemplate: baseTemplate(),
    config: { [Key.WELCOME_IMAGE_KEY]: `${guildId}/welcome.png` },
    guildId,
    entitlement: { ok: true, granted: true, code: EntitlementDecision.GRANTED },
    imageStore: store,
  });
}

/** Compte les accès au sidecar, pour prouver qu'il n'est ni lu ni écrit. */
function spyOnSidecar(store) {
  const calls = { uploadMeta: 0, downloadMeta: 0, removeMeta: 0 };
  for (const method of Object.keys(calls)) {
    const original = typeof store[method] === "function" ? store[method].bind(store) : null;
    if (!original) continue;
    store[method] = async (...args) => { calls[method] += 1; return original(...args); };
  }
  return calls;
}

test("Rendu — une image personnalisée ne porte AUCUNE zone avatar", async () => {
  const result = await resolveCustom({ [IMAGE_KEY_A]: smallPng() });
  assert.equal(result.design.avatar, null, "aucune géométrie avatar ne doit subsister");
  assert.equal(result.design.customImage, true, "le template doit être marqué en mode image personnalisée");
  assert.ok(result.design.background.buffer, "l'image personnalisée reste injectée");
});

test("Rendu — un welcome.json historique ne réintroduit aucune zone avatar", async () => {
  // Le rendu est piloté par le MODE réellement configuré, jamais par la présence
  // accidentelle d'un sidecar écrit par la Phase 2.1. C'est ce qui garantit
  // qu'une ancienne image personnalisée accompagnée de son ancien welcome.json
  // ne produit pas un rendu avec avatar.
  const result = await resolveCustom({
    [IMAGE_KEY_A]: smallPng(),
    [META_KEY_A]: metaSidecar({ cx: 900, cy: 140, radius: 60 }),
  });
  assert.equal(result.design.avatar, null, "un sidecar CONFIRME hérité ne doit plus influencer le rendu");
  assert.equal(result.design.customImage, true);
});

test("Rendu — le sidecar de géométrie n'est même plus lu", async () => {
  const store = new WelcomeImageStore({
    storage: createStorageFake({
      [IMAGE_KEY_A]: smallPng(),
      [META_KEY_A]: metaSidecar({ cx: 900, cy: 140, radius: 60 }),
    }),
  });
  const calls = spyOnSidecar(store);
  await resolveCustom({ [IMAGE_KEY_A]: smallPng() }, GUILD_A, store);
  assert.equal(calls.downloadMeta, 0, "aucune lecture du sidecar : le mode configuré suffit");
});

test("Rendu — le registre global n'est jamais muté par l'image personnalisée", async () => {
  const registry = new WelcomeTemplateRegistry();
  registry.discover();
  const before = JSON.stringify(registry.get("template-1").design);
  await resolveCustom({ [IMAGE_KEY_A]: smallPng() });
  assert.equal(JSON.stringify(registry.get("template-1").design), before, "le registre partagé doit rester intact");
});

// ══════════════════════════════════════════════════════════════════════════
// D. Upload — Phase 2.2 : aucune détection, aucun sidecar écrit
// ══════════════════════════════════════════════════════════════════════════

/**
 * Image contenant un CERCLE GRAPHIQUE net : l'ancien détecteur le confirmait
 * sans ambiguïté. Elle sert de preuve que CIVRAT ne cherche plus ce cercle et
 * ne place aucun avatar dessus.
 */
function imageWithGraphicCircle() {
  return welcomeImageWithCircle(1000, 146, 110, { fill: "#5865f2" });
}

test("Upload — aucune détection de cercle n'est exécutée", async () => {
  const storage = createStorageFake();
  const imageStore = new WelcomeImageStore({ storage });
  const calls = spyOnSidecar(imageStore);
  const settings = createSettingsFake();
  const buffer = imageWithGraphicCircle();

  const result = await withFetch(buffer, () => uploadWelcomeImage(uploadContext({
    imageStore, settings, attachment: attachmentFor(buffer),
  })));

  assert.equal(result.ok, true, `upload refusé : ${result.reason || result.code}`);
  assert.equal(result.code, "WELCOME_IMAGE_UPLOADED");
  assert.equal(result.avatarCircle, undefined, "le résultat ne porte plus de verdict de détection");
  assert.equal(calls.uploadMeta, 0, "aucune géométrie ne doit être écrite");
  assert.equal(calls.downloadMeta, 0, "aucune géométrie ne doit être lue");
  assert.ok(storage.objects.has(IMAGE_KEY_A), "l'image doit être stockée");
  assert.equal(storage.objects.has(META_KEY_A), false, "aucun sidecar ne doit être créé");
  assert.deepEqual(settings.updates.at(-1).patch, { [Key.WELCOME_IMAGE_KEY]: IMAGE_KEY_A }, "welcome_image_key doit être persisté");
});

test("Upload — un welcome.json hérité de la Phase 2.1 est purgé", async () => {
  const stale = { version: 1, verdict: "CONFIRME", avatar: { cx: 900, cy: 90, radius: 40 } };
  const storage = createStorageFake({
    [IMAGE_KEY_A]: smallPng(),
    [META_KEY_A]: Buffer.from(JSON.stringify(stale), "utf8"),
  });
  const buffer = imageWithGraphicCircle();

  const result = await withFetch(buffer, () => uploadWelcomeImage(uploadContext({
    imageStore: new WelcomeImageStore({ storage }),
    settings: createSettingsFake(),
    attachment: attachmentFor(buffer),
  })));

  assert.equal(result.ok, true);
  assert.ok(storage.objects.has(IMAGE_KEY_A), "la nouvelle image doit être conservée");
  assert.equal(storage.objects.has(META_KEY_A), false, "la géométrie héritée doit être purgée");
});

test("Upload — la purge du sidecar n'emporte jamais l'image", async () => {
  const storage = createStorageFake({ [IMAGE_KEY_A]: smallPng() });
  const buffer = imageWithGraphicCircle();
  await withFetch(buffer, () => uploadWelcomeImage(uploadContext({
    imageStore: new WelcomeImageStore({ storage }),
    settings: createSettingsFake(),
    attachment: attachmentFor(buffer),
  })));
  assert.ok(storage.objects.has(IMAGE_KEY_A), "la purge du sidecar ne doit pas emporter l'image");
  const removals = storage.calls.filter((call) => call.op === "remove").flatMap((call) => call.objectNames);
  assert.ok(!removals.includes(IMAGE_KEY_A), `l'image ne doit jamais être ciblée par la purge : ${removals.join(", ")}`);
});

test("Upload — un échec de purge du sidecar n'annule pas l'upload", async () => {
  const storage = createStorageFake({ [META_KEY_A]: Buffer.from("{}", "utf8") }, { failRemoveOn: META_KEY_A });
  const settings = createSettingsFake();
  const logger = createLogger();
  const buffer = imageWithGraphicCircle();

  const result = await withFetch(buffer, () => uploadWelcomeImage(uploadContext({
    imageStore: new WelcomeImageStore({ storage }), settings, logger, attachment: attachmentFor(buffer),
  })));

  assert.equal(result.ok, true, "l'upload doit réussir même si la purge échoue");
  assert.ok(storage.objects.has(IMAGE_KEY_A), "l'image doit rester stockée");
  assert.deepEqual(settings.updates.at(-1).patch, { [Key.WELCOME_IMAGE_KEY]: IMAGE_KEY_A });
  assert.ok(
    logger.logs.some((log) => log.message === "Welcome avatar geometry sidecar could not be purged"),
    "un échec de purge doit être traçable, jamais silencieux",
  );
});

test("Upload — l'administrateur reçoit une confirmation unique, sans verdict de détection", async () => {
  const transport = createTransportFake();
  const buffer = imageWithGraphicCircle();
  await withFetch(buffer, () => uploadWelcomeImage(uploadContext({
    transport, attachment: attachmentFor(buffer),
  })));
  const text = transport.calls.map((call) => call.content).filter(Boolean).join(" ");
  assert.ok(text.includes("welcomeGoodbye.welcomeImageUploaded"), "l'upload reste confirmé");
  assert.ok(!text.includes("welcomeImageAvatarDetected"), "plus aucun message de détection");
  assert.ok(!text.includes("welcomeImageAvatarUnconfirmed"), "plus aucun message de détection");
});

test("Upload — le téléversement n'active toujours pas welcome_image_enabled", async () => {
  const settings = createSettingsFake();
  const buffer = imageWithGraphicCircle();
  await withFetch(buffer, () => uploadWelcomeImage(uploadContext({
    settings, attachment: attachmentFor(buffer),
  })));
  const patched = settings.updates.flatMap((update) => Object.keys(update.patch));
  assert.ok(!patched.includes(Key.WELCOME_IMAGE_ENABLED), "aucune auto-activation après upload");
  assert.deepEqual(patched, [Key.WELCOME_IMAGE_KEY]);
});

test("Upload — la détection n'est plus journalisée, l'invalidation de cache l'est toujours", async () => {
  const logger = createLogger();
  const buffer = imageWithGraphicCircle();
  await withFetch(buffer, () => uploadWelcomeImage(uploadContext({
    logger, attachment: attachmentFor(buffer),
  })));
  assert.equal(
    logger.logs.some((log) => log.message === "Welcome avatar circle detection"),
    false,
    "aucune trace de détection ne doit subsister",
  );
  assert.ok(
    logger.logs.some((log) => log.message === "Welcome image cache invalidated on upload"),
    "le correctif de cache de la Phase 2.1 doit rester intact",
  );
});

// ══════════════════════════════════════════════════════════════════════════
// E. Bout en bout — l'image personnalisée reste l'image de l'administrateur
// ══════════════════════════════════════════════════════════════════════════

async function pixelsOf(buffer) {
  const image = await loadImage(buffer);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  return ctx.getImageData(0, 0, image.width, image.height);
}

function countMatching({ data }, matches) {
  let count = 0;
  for (let i = 0; i < data.length; i += 4) if (matches(data[i], data[i + 1], data[i + 2])) count += 1;
  return count;
}

const isGreen = (r, g, b) => g > 180 && r < 120 && b < 120;
const isBright = (r, g, b) => r > 100 && g > 100 && b > 100;

function countBrightInBox(pixels, x0, y0, x1, y1) {
  let count = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = (y * pixels.width + x) * 4;
      if (isBright(pixels.data[i], pixels.data[i + 1], pixels.data[i + 2])) count += 1;
    }
  }
  return count;
}

test("Bout en bout — une image contenant un cercle graphique ne reçoit AUCUN avatar", async () => {
  const { WelcomeImageRenderer } = require("../image/rendering/WelcomeImageRenderer");

  const custom = imageWithGraphicCircle();
  // Précondition indispensable : ce cercle EST détectable. Sans cela le test ne
  // prouverait rien — il passerait aussi avec une image sans aucun cercle.
  const detection = await detectAvatarCircle(custom, { guildId: GUILD_A });
  assert.equal(detection.verdict, AvatarCircleVerdict.CONFIRMED, "précondition : le cercle doit être détectable");

  const template = await resolveCustom({ [IMAGE_KEY_A]: custom });
  assert.equal(template.design.avatar, null, "aucune zone avatar ne doit être dérivée");

  // Avatar de test vert fluo : s'il était dessiné quelque part, il serait
  // immanquable sur le fond bleu nuit de l'image.
  const avatar = createCanvas(256, 256);
  const actx = avatar.getContext("2d");
  actx.fillStyle = "#00ff00";
  actx.fillRect(0, 0, 256, 256);
  const renderer = new WelcomeImageRenderer({ avatarLoader: async () => avatar.toBuffer("image/png") });
  const payload = await renderer.render(
    {
      guildId: GUILD_A,
      userId: "u",
      avatarUrl: "http://x/a.png",
      displayName: "Alice",
      textElements: [{ id: "title", content: "Alice" }],
      dimensions: { width: CARD_W, height: CARD_H },
    },
    template,
  );

  const pixels = await pixelsOf(payload.buffer);
  assert.equal(countMatching(pixels, isGreen), 0, "aucun pixel d'avatar sur une image personnalisée");

  // Le cercle dessiné PAR L'ADMINISTRATEUR doit être intact, non recouvert.
  const at = (x, y) => {
    const i = (y * pixels.width + x) * 4;
    return [pixels.data[i], pixels.data[i + 1], pixels.data[i + 2]];
  };
  assert.deepEqual(at(1000, 146), [0x58, 0x65, 0xf2], "le cercle de l'image doit rester visible");
});

test("Bout en bout — le pseudo/nom est le SEUL élément ajouté à l'image personnalisée", async () => {
  const { WelcomeImageRenderer } = require("../image/rendering/WelcomeImageRenderer");

  // Fond uniformément noir : tout ce que CIVRAT dessine dessus est visible.
  const black = createCanvas(CARD_W, CARD_H);
  const bctx = black.getContext("2d");
  bctx.fillStyle = "#000000";
  bctx.fillRect(0, 0, CARD_W, CARD_H);

  const resolved = await resolveCustom({ [IMAGE_KEY_A]: black.toBuffer("image/png") });
  const design = resolved.design;
  const request = {
    guildId: GUILD_A,
    userId: "u",
    avatarUrl: null,
    displayName: "Alice",
    textElements: [
      { id: "title", content: "Alice" },
      { id: "subtitle", content: "Welcome to the server" },
    ],
    dimensions: { width: CARD_W, height: CARD_H },
  };
  const renderer = new WelcomeImageRenderer({ avatarLoader: async () => null });

  const customCard = await pixelsOf((await renderer.render(request, resolved)).buffer);
  const titleBox = [design.title.x, 4, design.title.x + 380, design.title.y + 10];
  const subtitleBox = [design.subtitle.x, design.subtitle.y - 26, design.subtitle.x + 380, design.subtitle.y + 4];

  assert.ok(countBrightInBox(customCard, ...titleBox) > 0, "le pseudo/nom du membre doit être dessiné");
  assert.equal(countBrightInBox(customCard, ...subtitleBox), 0, "le sous-titre ne doit PAS être dessiné en mode image personnalisée");

  // Contrôle du test : le MÊME template repassé en mode standard dessine bien
  // le pseudo/nom (la boîte de mesure du titre est donc correcte) mais ne
  // dessine PLUS le sous-titre : le message Welcome n'est jamais rendu dans
  // l'image, quel que soit le mode. L'absence de sous-titre est voulue, pas un
  // accident de rendu ou une boîte mal placée.
  const standard = { ...resolved, design: { ...design, customImage: false } };
  const standardCard = await pixelsOf((await renderer.render(request, standard)).buffer);
  assert.ok(countBrightInBox(standardCard, ...titleBox) > 0, "en mode standard le pseudo/nom est dessiné — contrôle");
  assert.equal(countBrightInBox(standardCard, ...subtitleBox), 0, "en mode standard le sous-titre n'est PLUS dessiné");
});
