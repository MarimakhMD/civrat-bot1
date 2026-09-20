"use strict";

/**
 * Détection automatique de la zone avatar d'une image Welcome personnalisée.
 *
 * Couvre la règle produit à trois verdicts :
 *   CONFIRME → géométrie détectée stockée puis utilisée au rendu ;
 *   AMBIGU   → image CONSERVÉE, aucune géométrie stockée, gabarit utilisé,
 *              administrateur averti ;
 *   AUCUN    → identique à AMBIGU.
 *
 * Le point critique est que l'upload reste fonctionnel dans les trois cas :
 * un échec de détection ne supprime ni ne refuse jamais l'image.
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
// C. Intégration au rendu
// ══════════════════════════════════════════════════════════════════════════

function metaSidecar(geometry, verdict = "CONFIRME") {
  return Buffer.from(JSON.stringify({ version: 1, verdict, avatar: geometry }), "utf8");
}

async function resolveWithSidecar(objects, guildId = GUILD_A) {
  const store = new WelcomeImageStore({ storage: createStorageFake(objects) });
  const template = baseTemplate();
  return resolveWelcomeImageTemplate({
    baseTemplate: template,
    config: { [Key.WELCOME_IMAGE_KEY]: `${guildId}/welcome.png` },
    guildId,
    entitlement: { ok: true, granted: true, code: EntitlementDecision.GRANTED },
    imageStore: store,
  });
}

test("Rendu — une géométrie CONFIRME remplace celle du gabarit", async () => {
  const result = await resolveWithSidecar({
    [IMAGE_KEY_A]: smallPng(),
    [META_KEY_A]: metaSidecar({ cx: 900, cy: 140, radius: 60 }),
  });
  assert.equal(result.design.avatar.cx, 900);
  assert.equal(result.design.avatar.cy, 140);
  assert.equal(result.design.avatar.radius, 60);
});

test("Rendu — ringColor et ringWidth du gabarit sont préservés", async () => {
  const result = await resolveWithSidecar({
    [IMAGE_KEY_A]: smallPng(),
    [META_KEY_A]: metaSidecar({ cx: 900, cy: 140, radius: 60 }),
  });
  const original = baseTemplate().design.avatar;
  assert.equal(result.design.avatar.ringColor, original.ringColor);
  assert.equal(result.design.avatar.ringWidth, original.ringWidth);
});

test("Rendu — un verdict AMBIGU laisse la géométrie du gabarit intacte", async () => {
  const result = await resolveWithSidecar({
    [IMAGE_KEY_A]: smallPng(),
    [META_KEY_A]: metaSidecar({ cx: 900, cy: 140, radius: 60 }, "AMBIGU"),
  });
  const original = baseTemplate().design.avatar;
  assert.deepEqual(
    { cx: result.design.avatar.cx, cy: result.design.avatar.cy, radius: result.design.avatar.radius },
    { cx: original.cx, cy: original.cy, radius: original.radius },
    "une géométrie incertaine ne doit jamais atteindre le rendu",
  );
  // L'image personnalisée reste bien injectée : seul le placement retombe.
  assert.ok(result.design.background.buffer, "l'image doit rester utilisée");
});

test("Rendu — sidecar absent, corrompu ou incohérent : géométrie du gabarit", async () => {
  const original = baseTemplate().design.avatar;
  const expected = { cx: original.cx, cy: original.cy, radius: original.radius };
  const cases = {
    "sidecar absent": { [IMAGE_KEY_A]: smallPng() },
    "JSON invalide": { [IMAGE_KEY_A]: smallPng(), [META_KEY_A]: Buffer.from("{ cassé", "utf8") },
    "avatar manquant": { [IMAGE_KEY_A]: smallPng(), [META_KEY_A]: Buffer.from('{"verdict":"CONFIRME"}', "utf8") },
    "rayon nul": { [IMAGE_KEY_A]: smallPng(), [META_KEY_A]: metaSidecar({ cx: 10, cy: 10, radius: 0 }) },
    "valeurs non numériques": { [IMAGE_KEY_A]: smallPng(), [META_KEY_A]: metaSidecar({ cx: "a", cy: null, radius: NaN }) },
    "cercle hors cadre": { [IMAGE_KEY_A]: smallPng(), [META_KEY_A]: metaSidecar({ cx: -500, cy: -500, radius: 10 }) },
  };
  for (const [label, objects] of Object.entries(cases)) {
    const result = await resolveWithSidecar(objects);
    assert.deepEqual(
      { cx: result.design.avatar.cx, cy: result.design.avatar.cy, radius: result.design.avatar.radius },
      expected,
      `${label} : la géométrie du gabarit doit être conservée`,
    );
  }
});

test("Rendu — le registre global n'est jamais muté par la géométrie détectée", async () => {
  const registry = new WelcomeTemplateRegistry();
  registry.discover();
  const before = JSON.stringify(registry.get("template-1").design.avatar);
  await resolveWithSidecar({ [IMAGE_KEY_A]: smallPng(), [META_KEY_A]: metaSidecar({ cx: 900, cy: 140, radius: 60 }) });
  assert.equal(JSON.stringify(registry.get("template-1").design.avatar), before, "le registre partagé doit rester intact");
});

test("Rendu — une géométrie d'une autre guilde est ignorée", async () => {
  const original = baseTemplate().design.avatar;
  const result = await resolveWithSidecar({
    [`${GUILD_B}/welcome.png`]: smallPng(),
    [`${GUILD_B}/welcome.json`]: metaSidecar({ cx: 900, cy: 140, radius: 60 }),
  }, GUILD_B);
  // La guilde B lit bien son propre sidecar ; la guilde A ne peut pas l'atteindre.
  assert.equal(result.design.avatar.cx, 900);
  const resultA = await resolveWithSidecar({
    [IMAGE_KEY_A]: smallPng(),
    [`${GUILD_B}/welcome.json`]: metaSidecar({ cx: 900, cy: 140, radius: 60 }),
  }, GUILD_A);
  assert.equal(resultA.design.avatar.cx, original.cx, "isolation par guildId");
});

// ══════════════════════════════════════════════════════════════════════════
// D. Upload — fonctionnel dans les trois verdicts
// ══════════════════════════════════════════════════════════════════════════

function imageWithThreeCircles() {
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
  return canvas.toBuffer("image/png");
}

test("Upload — CONFIRME : image stockée, sidecar écrit, clé persistée", async () => {
  const storage = createStorageFake();
  const imageStore = new WelcomeImageStore({ storage });
  const settings = createSettingsFake();
  const transport = createTransportFake();
  const buffer = welcomeImageWithCircle(216, 146, 120);

  const result = await withFetch(buffer, () => uploadWelcomeImage(uploadContext({
    imageStore, settings, transport, attachment: attachmentFor(buffer),
  })));

  assert.equal(result.ok, true, `upload refusé : ${result.reason || result.code}`);
  assert.equal(result.code, "WELCOME_IMAGE_UPLOADED");
  assert.equal(result.avatarCircle.verdict, AvatarCircleVerdict.CONFIRMED);
  assert.ok(result.avatarCircle.geometry, "une géométrie doit être renvoyée");
  assert.ok(storage.objects.has(IMAGE_KEY_A), "l'image doit être stockée");
  assert.ok(storage.objects.has(META_KEY_A), "le sidecar doit être écrit");
  const stored = JSON.parse(storage.objects.get(META_KEY_A).toString("utf8"));
  assert.equal(stored.verdict, "CONFIRME");
  assert.equal(stored.avatar.cx, result.avatarCircle.geometry.cx);
  assert.deepEqual(settings.updates.at(-1).patch, { [Key.WELCOME_IMAGE_KEY]: IMAGE_KEY_A }, "welcome_image_key doit être persisté");
});

test("Upload — AUCUN : l'image reste stockée, aucun sidecar, clé persistée", async () => {
  const storage = createStorageFake();
  const settings = createSettingsFake();
  const buffer = plainWelcomeImage();

  const result = await withFetch(buffer, () => uploadWelcomeImage(uploadContext({
    imageStore: new WelcomeImageStore({ storage }),
    settings,
    attachment: attachmentFor(buffer),
  })));

  assert.equal(result.ok, true, "l'upload doit réussir malgré l'absence de détection");
  assert.equal(result.code, "WELCOME_IMAGE_UPLOADED");
  assert.equal(result.avatarCircle.verdict, AvatarCircleVerdict.NONE);
  assert.equal(result.avatarCircle.geometry, null);
  assert.ok(storage.objects.has(IMAGE_KEY_A), "l'image ne doit PAS être supprimée");
  assert.equal(storage.objects.has(META_KEY_A), false, "aucune géométrie incertaine ne doit être stockée");
  assert.deepEqual(settings.updates.at(-1).patch, { [Key.WELCOME_IMAGE_KEY]: IMAGE_KEY_A }, "welcome_image_key doit être persisté");
});

test("Upload — AMBIGU : image conservée, aucun sidecar, clé persistée", async () => {
  const storage = createStorageFake();
  const settings = createSettingsFake();
  const buffer = imageWithThreeCircles();

  const result = await withFetch(buffer, () => uploadWelcomeImage(uploadContext({
    imageStore: new WelcomeImageStore({ storage }),
    settings,
    attachment: attachmentFor(buffer),
  })));

  assert.equal(result.ok, true, "l'upload doit réussir malgré l'ambiguïté");
  assert.equal(result.avatarCircle.verdict, AvatarCircleVerdict.AMBIGUOUS);
  assert.ok(storage.objects.has(IMAGE_KEY_A), "l'image ne doit PAS être supprimée");
  assert.equal(storage.objects.has(META_KEY_A), false, "aucune géométrie incertaine ne doit être stockée");
  assert.deepEqual(settings.updates.at(-1).patch, { [Key.WELCOME_IMAGE_KEY]: IMAGE_KEY_A });
});

test("Upload — un verdict non confirmé PURGE le sidecar de l'image précédente", async () => {
  // Régression : après une image A confirmée, un re-upload B ambigu laissait le
  // sidecar de A en place. Le rendu appliquait alors la zone de A à l'image B.
  const stale = { version: 1, verdict: "CONFIRME", avatar: { cx: 900, cy: 90, radius: 40 } };
  const storage = createStorageFake({
    [IMAGE_KEY_A]: smallPng(),
    [META_KEY_A]: Buffer.from(JSON.stringify(stale), "utf8"),
  });
  const buffer = imageWithThreeCircles();

  const result = await withFetch(buffer, () => uploadWelcomeImage(uploadContext({
    imageStore: new WelcomeImageStore({ storage }),
    settings: createSettingsFake(),
    attachment: attachmentFor(buffer),
  })));

  assert.equal(result.ok, true);
  assert.equal(result.avatarCircle.verdict, AvatarCircleVerdict.AMBIGUOUS);
  assert.ok(storage.objects.has(IMAGE_KEY_A), "la nouvelle image doit être conservée");
  assert.equal(storage.objects.has(META_KEY_A), false,
    "la géométrie de l'ancienne image doit être purgée, pas réutilisée sur la nouvelle");
});

test("Upload — un verdict non confirmé ne supprime jamais l'image", async () => {
  const storage = createStorageFake({ [IMAGE_KEY_A]: smallPng() });
  const buffer = imageWithThreeCircles();
  await withFetch(buffer, () => uploadWelcomeImage(uploadContext({
    imageStore: new WelcomeImageStore({ storage }),
    settings: createSettingsFake(),
    attachment: attachmentFor(buffer),
  })));
  assert.ok(storage.objects.has(IMAGE_KEY_A), "la purge du sidecar ne doit pas emporter l'image");
  const removals = storage.calls.filter((call) => call.op === "remove").flatMap((call) => call.objectNames);
  assert.ok(!removals.includes(IMAGE_KEY_A), `l'image ne doit jamais être ciblée par la purge : ${removals.join(", ")}`);
});

test("Upload — l'administrateur est averti différemment selon le verdict", async () => {
  const confirmedBuffer = welcomeImageWithCircle(216, 146, 120);
  const confirmed = createTransportFake();
  await withFetch(confirmedBuffer, () => uploadWelcomeImage(uploadContext({
    transport: confirmed,
    attachment: attachmentFor(confirmedBuffer),
  })));

  const plainBuffer = plainWelcomeImage();
  const unconfirmed = createTransportFake();
  await withFetch(plainBuffer, () => uploadWelcomeImage(uploadContext({
    transport: unconfirmed,
    attachment: attachmentFor(plainBuffer),
  })));

  const textOf = (fake) => fake.calls.map((call) => call.content).filter(Boolean).join(" ");
  assert.ok(textOf(confirmed).includes("welcomeGoodbye.welcomeImageAvatarDetected"), "verdict confirmé annoncé");
  assert.ok(textOf(unconfirmed).includes("welcomeGoodbye.welcomeImageAvatarUnconfirmed"), "verdict non confirmé annoncé");
  assert.ok(!textOf(confirmed).includes("Unconfirmed"), "les deux messages ne doivent pas se cumuler");
  // La confirmation d'enregistrement reste présente dans les deux cas.
  assert.ok(textOf(unconfirmed).includes("welcomeGoodbye.welcomeImageUploaded"), "l'upload reste confirmé même sans détection");
});

test("Upload — un échec d'écriture du sidecar n'annule pas l'upload", async () => {
  const storage = createStorageFake({}, { failUploadOn: META_KEY_A });
  const settings = createSettingsFake();
  const buffer = welcomeImageWithCircle(216, 146, 120);

  const result = await withFetch(buffer, () => uploadWelcomeImage(uploadContext({
    imageStore: new WelcomeImageStore({ storage }),
    settings,
    attachment: attachmentFor(buffer),
  })));

  assert.equal(result.ok, true, "l'upload doit réussir même si le sidecar échoue");
  assert.ok(storage.objects.has(IMAGE_KEY_A), "l'image doit rester stockée");
  assert.deepEqual(settings.updates.at(-1).patch, { [Key.WELCOME_IMAGE_KEY]: IMAGE_KEY_A });
});

test("Upload — le téléversement n'active toujours pas welcome_image_enabled", async () => {
  const settings = createSettingsFake();
  const buffer = welcomeImageWithCircle(216, 146, 120);
  await withFetch(buffer, () => uploadWelcomeImage(uploadContext({
    settings,
    attachment: attachmentFor(buffer),
  })));
  const patched = settings.updates.flatMap((update) => Object.keys(update.patch));
  assert.ok(!patched.includes(Key.WELCOME_IMAGE_ENABLED), "aucune auto-activation après upload");
  assert.deepEqual(patched, [Key.WELCOME_IMAGE_KEY]);
});

test("Upload — la détection est journalisée avec son verdict", async () => {
  const logger = createLogger();
  const buffer = welcomeImageWithCircle(216, 146, 120);
  await withFetch(buffer, () => uploadWelcomeImage(uploadContext({
    logger,
    attachment: attachmentFor(buffer),
  })));
  const entry = logger.logs.find((log) => log.message === "Welcome avatar circle detection");
  assert.ok(entry, "la décision doit être traçable");
  assert.equal(entry.guildId, GUILD_A);
  assert.ok([AvatarCircleVerdict.CONFIRMED, AvatarCircleVerdict.AMBIGUOUS, AvatarCircleVerdict.NONE].includes(entry.verdict));
});

// ══════════════════════════════════════════════════════════════════════════
// E. Bout en bout — la géométrie détectée déplace réellement l'avatar
// ══════════════════════════════════════════════════════════════════════════

test("Bout en bout — l'avatar est rendu dans la zone détectée", async () => {
  const { WelcomeImageRenderer } = require("../image/rendering/WelcomeImageRenderer");
  const detected = welcomeImageWithCircle(1000, 146, 110, { fill: "#20304a" });

  const detection = await detectAvatarCircle(detected, { guildId: GUILD_A });
  assert.equal(detection.verdict, AvatarCircleVerdict.CONFIRMED, "précondition : le cercle doit être détecté");

  const storage = createStorageFake({
    [IMAGE_KEY_A]: detected,
    [META_KEY_A]: metaSidecar(detection.geometry),
  });
  const template = await resolveWithSidecar({
    [IMAGE_KEY_A]: detected,
    [META_KEY_A]: metaSidecar(detection.geometry),
  });
  assert.equal(storage.objects.has(IMAGE_KEY_A), true);

  const avatar = createCanvas(256, 256);
  const actx = avatar.getContext("2d");
  actx.fillStyle = "#00ff00";
  actx.fillRect(0, 0, 256, 256);
  const renderer = new WelcomeImageRenderer({ avatarLoader: async () => avatar.toBuffer("image/png") });
  const payload = await renderer.render(
    { guildId: GUILD_A, userId: "u", avatarUrl: "http://x/a.png", displayName: "Alice", textElements: [], dimensions: { width: CARD_W, height: CARD_H } },
    template,
  );

  const image = await loadImage(payload.buffer);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, image.width, image.height);

  // L'avatar doit être présent dans la zone DÉTECTÉE et absent de celle du gabarit.
  const greenAt = (cx, cy) => {
    const i = (Math.round(cy) * width + Math.round(cx)) * 4;
    return data[i + 1] > 180 && data[i] < 120 && data[i + 2] < 120;
  };
  const original = baseTemplate().design.avatar;
  assert.equal(greenAt(detection.geometry.cx, detection.geometry.cy), true, "l'avatar doit être au centre de la zone détectée");
  assert.equal(greenAt(original.cx, original.cy), false, "l'avatar ne doit plus être à la position du gabarit");
  // Et il doit couvrir le cercle détecté, pas seulement son centre.
  assert.equal(greenAt(detection.geometry.cx, detection.geometry.cy - detection.geometry.radius * 0.8), true, "le cercle doit être rempli");
  assert.ok(height > 0 && width > 0);
});
