"use strict";

/**
 * Observabilité et robustesse du téléchargement de l'image Welcome.
 *
 * Couvre le correctif du bug « Ce fichier n'est pas une image valide. » renvoyé
 * pour un PNG valide : la cause réelle était avalée par des `catch {}` et aucun
 * log n'était produit sur le chemin de refus.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { createCanvas } = require("@napi-rs/canvas");

const {
  WelcomeImageRejectReason: R,
  ACCEPTED_IMAGE_CONTENT_TYPES,
  checkWelcomeImageAttachment,
  fetchWelcomeImageBuffer,
  decodeWelcomeImage,
  detectImageFormat,
  inspectImageHeader,
  hexHead,
} = require("../services/welcomeImageUploadValidation");
const { uploadWelcomeImage } = require("../interactions/welcomeImageUpload");
const { WelcomeImageStore } = require("../services/WelcomeImageStore");
const { WelcomeTemplateRegistry } = require("../rendering/WelcomeTemplateRegistry");
const { WelcomeResourceCache } = require("../rendering/WelcomeResourceCache");
const { WelcomeGoodbyeConfigKey: Key } = require("../configuration/welcomeGoodbyeConstants");

const GUILD_A = "111111111111111111";
const KEY_A = `${GUILD_A}/welcome.png`;
const HTML_ERROR = Buffer.from("<!doctype html><html><title>403 Forbidden</title><body>blocked by proxy</body></html>");

function png(w = 64, h = 64) {
  const c = createCanvas(w, h);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#2f6fb2";
  ctx.fillRect(0, 0, w, h);
  return c.toBuffer("image/png");
}

function createLogger() {
  const logs = [];
  const push = (level) => (message, meta = {}) => logs.push({ level, message, ...meta });
  return { logs, info: push("info"), warn: push("warn"), error: push("error"), debug: push("debug") };
}

function createStorageFake(seed = {}) {
  const objects = new Map(Object.entries(seed));
  const calls = [];
  return {
    calls, objects,
    from() {
      return {
        async upload(name, buffer, options = {}) { calls.push({ op: "upload", name, options }); objects.set(name, Buffer.from(buffer)); return { error: null }; },
        async download(name) { const v = objects.get(name); return v ? { data: v, error: null } : { data: null, error: { message: "nf" } }; },
        async remove(names) { calls.push({ op: "remove", names }); for (const n of names) objects.delete(n); return { error: null }; },
      };
    },
  };
}

async function withFetch(impl, run) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try { return await run(); } finally { globalThis.fetch = original; }
}

/** Réponse fetch minimale mais fidèle (headers.get). */
function response(body, { status = 200, contentType = "application/octet-stream" } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (name.toLowerCase() === "content-type" ? contentType : null) },
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.length),
  };
}

function createTemplateRegistry() {
  const registry = new WelcomeTemplateRegistry();
  registry.discover();
  return registry;
}

function uploadContext({ storage, attachment, granted = true, code = null, attachmentSizeLimit = 25 * 1024 * 1024, config } = {}) {
  const settings = {
    updates: [],
    async get() { return { [Key.WELCOME_IMAGE_ENABLED]: true, [Key.WELCOME_TEMPLATE]: "template-1", [Key.WELCOME_IMAGE_KEY]: null, ...(config || {}) }; },
    async update(guildId, patch) { this.updates.push({ guildId, patch }); return this.get(); },
  };
  const transportCalls = [];
  const transport = {
    async reply(payload) { transportCalls.push({ kind: "reply", content: payload?.view?.content }); return {}; },
    async update(payload) { transportCalls.push({ kind: "update" }); return {}; },
    async replyImagePreview(payload) { transportCalls.push({ kind: "imagePreview" }); return {}; },
  };
  const logger = createLogger();
  const adminCalls = [];
  return {
    logger, logs: logger.logs, transportCalls, settings,
    t: (key) => key,
    guildId: GUILD_A,
    userId: "999999999999999999",
    entitlementService: { async requireFeature() { return { ok: granted, granted, code: code || (granted ? "GRANTED" : "PREMIUM_REQUIRED") }; } },
    imageStore: new WelcomeImageStore({ storage: storage || createStorageFake() }),
    resourceCache: new WelcomeResourceCache(),
    imagePipeline: { generate: async () => ({ buffer: Buffer.from("card") }) },
    templateRegistry: createTemplateRegistry(),
    adminLogService: { record: (entry) => adminCalls.push(entry) },
    adminCalls,
    envelope: { transport, attachmentSizeLimit, options: { getAttachment: () => attachment ?? null } },
  };
}

// ══════════════════════════════════════════════════════════════════════════
// A. Détection de format sur les octets réels
// ══════════════════════════════════════════════════════════════════════════

test("Diagnostics — detectImageFormat identifie les 5 formats sur les octets", () => {
  const c = createCanvas(32, 32);
  c.getContext("2d").fillRect(0, 0, 32, 32);
  assert.equal(detectImageFormat(png()), "png");
  assert.equal(detectImageFormat(c.toBuffer("image/jpeg")), "jpeg");
  assert.equal(detectImageFormat(c.toBuffer("image/webp")), "webp");
  assert.equal(detectImageFormat(c.toBuffer("image/gif")), "gif");
  assert.equal(detectImageFormat(c.toBuffer("image/avif")), "avif");
  assert.equal(ACCEPTED_IMAGE_CONTENT_TYPES.length, 5);
});

test("Diagnostics — detectImageFormat rejette le HTML, le JSON, le PDF et le vide", () => {
  for (const body of [HTML_ERROR, Buffer.from('{"error":"expired"}'), Buffer.from("%PDF-1.4 fake"), Buffer.alloc(0), Buffer.from("court")]) {
    assert.equal(detectImageFormat(body), null);
  }
  assert.equal(hexHead(png()).startsWith("89 50 4e 47"), true);
});

// ══════════════════════════════════════════════════════════════════════════
// B. Téléchargement : les trois échecs sont désormais distincts
// ══════════════════════════════════════════════════════════════════════════

test("Téléchargement — HTTP 200 + corps HTML ⇒ CDN_UNEXPECTED_CONTENT (et non « fichier invalide »)", async () => {
  const logger = createLogger();
  const result = await withFetch(async () => response(HTML_ERROR, { contentType: "text/html" }),
    () => fetchWelcomeImageBuffer({ url: "https://cdn/i.png", size: HTML_ERROR.length }, { logger, guildId: GUILD_A }));
  assert.equal(result.reason, R.CDN_UNEXPECTED_CONTENT);
  assert.equal(result.detail.httpContentType, "text/html");
  assert.equal(result.detail.bytes, HTML_ERROR.length);
  assert.ok(result.detail.head.startsWith("3c 21 64 6f"), "les premiers octets sont conservés");
  assert.equal(logger.logs.some((l) => l.message === "Welcome image download attempt failed"), true);
});

test("Téléchargement — erreur réseau ⇒ FETCH_FAILED avec la cause réelle journalisée", async () => {
  const logger = createLogger();
  const result = await withFetch(async () => { const e = new Error("getaddrinfo ENOTFOUND cdn.discordapp.com"); e.name = "AggregateError"; throw e; },
    () => fetchWelcomeImageBuffer({ url: "https://cdn/i.png" }, { logger, guildId: GUILD_A }));
  assert.equal(result.reason, R.FETCH_FAILED);
  assert.equal(result.detail.stage, "connect");
  assert.equal(result.detail.errorName, "AggregateError");
  assert.ok(result.detail.errorMessage.includes("ENOTFOUND"), "la cause DNS est conservée");
});

test("Téléchargement — HTTP 403 ⇒ FETCH_FAILED avec le statut journalisé", async () => {
  const logger = createLogger();
  const result = await withFetch(async () => response(Buffer.from("nope"), { status: 403, contentType: "text/plain" }),
    () => fetchWelcomeImageBuffer({ url: "https://cdn/i.png" }, { logger, guildId: GUILD_A }));
  assert.equal(result.reason, R.FETCH_FAILED);
  assert.equal(result.detail.status, 403);
});

test("Téléchargement — corps vide ⇒ EMPTY_FILE, distinct des deux autres", async () => {
  const result = await withFetch(async () => response(Buffer.alloc(0)),
    () => fetchWelcomeImageBuffer({ url: "https://cdn/i.png" }, { logger: createLogger(), guildId: GUILD_A }));
  assert.equal(result.reason, R.EMPTY_FILE);
});

test("Téléchargement — repli sur proxyURL quand l'URL principale est filtrée", async () => {
  const logger = createLogger();
  const image = png();
  const seen = [];
  const result = await withFetch(async (url) => {
    seen.push(url);
    return url.includes("media.discordapp.net") ? response(image, { contentType: "image/png" }) : response(HTML_ERROR, { contentType: "text/html" });
  }, () => fetchWelcomeImageBuffer({ url: "https://cdn.discordapp.com/i.png", proxyURL: "https://media.discordapp.net/i.png", size: image.length }, { logger, guildId: GUILD_A }));

  assert.deepEqual(seen, ["https://cdn.discordapp.com/i.png", "https://media.discordapp.net/i.png"], "les deux URL sont essayées");
  assert.equal(result.ok, true);
  assert.equal(result.buffer.equals(image), true);
  assert.equal(logger.logs.some((l) => l.message === "Welcome image downloaded from fallback URL"), true);
});

test("Téléchargement — les deux URL échouent : la dernière raison est retenue et chaque essai est journalisé", async () => {
  const logger = createLogger();
  const result = await withFetch(async () => response(HTML_ERROR, { contentType: "text/html" }),
    () => fetchWelcomeImageBuffer({ url: "https://cdn/i.png", proxyURL: "https://media/i.png", size: HTML_ERROR.length }, { logger, guildId: GUILD_A }));
  assert.equal(result.reason, R.CDN_UNEXPECTED_CONTENT);
  assert.equal(logger.logs.filter((l) => l.message === "Welcome image download attempt failed").length, 2);
});

test("Téléchargement — écart de taille : avertissement journalisé mais PAS de rejet", async () => {
  const logger = createLogger();
  const image = png();
  const result = await withFetch(async () => response(image, { contentType: "image/png" }),
    () => fetchWelcomeImageBuffer({ url: "https://cdn/i.png", size: image.length + 999 }, { logger, guildId: GUILD_A }));
  assert.equal(result.ok, true, "le proxy Discord peut servir une variante : ce n'est pas un refus");
  assert.equal(result.detail.sizeMismatch, true);
  assert.equal(logger.logs.some((l) => l.message === "Welcome image downloaded with unexpected size"), true);
});

test("Téléchargement — aucune URL utilisable ⇒ MISSING_ATTACHMENT", async () => {
  const logger = createLogger();
  const result = await fetchWelcomeImageBuffer({ contentType: "image/png", size: 10 }, { logger, guildId: GUILD_A });
  assert.equal(result.reason, R.MISSING_ATTACHMENT);
  assert.equal(logger.logs.some((l) => l.message === "Welcome image download skipped: attachment has no URL"), true);
});

// ══════════════════════════════════════════════════════════════════════════
// C. Décodage : l'erreur n'est plus avalée
// ══════════════════════════════════════════════════════════════════════════

test("Décodage — un PNG à IHDR piégé est refusé AVANT loadImage (anti-crash de processus)", async () => {
  // @napi-rs/canvas SIGSEGV sur un PNG dont la signature est valide mais
  // l'en-tête incohérent. Un try/catch n'arrête pas un signal : sans la
  // vérification d'en-tête, un tel fichier téléversé ferait tomber le bot.
  // Ces assertions s'exécutent dans le processus de test : si la protection
  // disparaît, le processus meurt au lieu d'échouer proprement.
  const valid = png();
  const cases = [
    ["hauteur nulle", (() => { const b = Buffer.from(valid); b.writeUInt32BE(0, 20); return b; })(), "height"],
    ["largeur nulle", (() => { const b = Buffer.from(valid); b.writeUInt32BE(0, 16); return b; })(), "width"],
    ["bitDepth hors jeu", (() => { const b = Buffer.from(valid); b[24] = 99; return b; })(), "bit-depth"],
    ["colorType hors jeu", (() => { const b = Buffer.from(valid); b[25] = 99; return b; })(), "color-type"],
    ["interlace invalide", (() => { const b = Buffer.from(valid); b[28] = 9; return b; })(), "ihdr-flags"],
  ];

  for (const [label, buffer] of cases) {
    const logger = createLogger();
    const result = await decodeWelcomeImage(buffer, { logger, guildId: GUILD_A });
    assert.equal(result.ok, false, `${label} doit être refusé`);
    assert.equal(result.reason, R.NOT_AN_IMAGE, `${label} : refus propre, pas de crash`);
    const logged = logger.logs.find((l) => l.message.startsWith("Welcome image header"));
    assert.ok(logged, `${label} : le refus est journalisé`);
    assert.equal(logged.guildId, GUILD_A);
    assert.ok(logged.head.length > 0, `${label} : les premiers octets sont conservés`);
  }
});

test("Décodage — un PNG sans chunk IDAT est refusé avant loadImage", async () => {
  const valid = png();
  const at = valid.indexOf("IDAT");
  const withoutIdat = Buffer.concat([valid.subarray(0, at - 4), valid.subarray(valid.length - 12)]);
  const truncatedAfterIhdr = valid.subarray(0, at - 4);

  for (const buffer of [withoutIdat, truncatedAfterIhdr]) {
    const logger = createLogger();
    const result = await decodeWelcomeImage(buffer, { logger, guildId: GUILD_A });
    assert.equal(result.ok, false);
    assert.equal(result.reason, R.NOT_AN_IMAGE);
    assert.ok(result.detail.headerReason.includes("idat") || result.detail.headerReason.includes("iend"),
      `raison structurelle attendue, obtenu ${result.detail.headerReason}`);
  }
});

test("Décodage — la bombe de pixels déclarée dans l'IHDR est bloquée AVANT décodage", async () => {
  // L'ancien code évaluait la limite APRÈS loadImage : un IHDR annonçant une
  // largeur énorme faisait SIGSEGV avant que la limite ne serve à quoi que ce soit.
  const valid = png();
  const bomb = Buffer.from(valid);
  bomb.writeUInt32BE(0x7fffffff, 16);

  const logger = createLogger();
  const result = await decodeWelcomeImage(bomb, { logger, guildId: GUILD_A });

  assert.equal(result.reason, R.TOO_MANY_PIXELS);
  assert.equal(result.detail.width, 0x7fffffff);
  assert.equal(logger.logs.some((l) => l.message === "Welcome image exceeds pixel limit"), true);
});

test("Décodage — aucune signature d'image ⇒ NOT_AN_IMAGE", async () => {
  const logger = createLogger();
  const result = await decodeWelcomeImage(HTML_ERROR, { logger, guildId: GUILD_A });
  assert.equal(result.reason, R.NOT_AN_IMAGE);
});

test("Décodage — les 5 formats valides restent acceptés", async () => {
  const c = createCanvas(48, 48);
  c.getContext("2d").fillRect(0, 0, 48, 48);
  const buffers = {
    png: png(48, 48),
    jpeg: c.toBuffer("image/jpeg"),
    webp: c.toBuffer("image/webp"),
    gif: c.toBuffer("image/gif"),
    avif: c.toBuffer("image/avif"),
  };
  for (const [format, buffer] of Object.entries(buffers)) {
    const result = await decodeWelcomeImage(buffer, { logger: createLogger(), guildId: GUILD_A });
    assert.equal(result.ok, true, `${format} doit être accepté`);
    assert.equal(result.width, 48);
    assert.equal(result.height, 48);
    assert.equal(result.format, format);
  }
});

test("Décodage — inspectImageHeader lit les dimensions réelles des 5 formats", () => {
  const c = createCanvas(120, 80);
  c.getContext("2d").fillRect(0, 0, 120, 80);
  const buffers = { png: png(120, 80), jpeg: c.toBuffer("image/jpeg"), webp: c.toBuffer("image/webp"), gif: c.toBuffer("image/gif"), avif: c.toBuffer("image/avif") };
  for (const [format, buffer] of Object.entries(buffers)) {
    const header = inspectImageHeader(buffer);
    assert.equal(header.ok, true, `${format} : en-tête lisible`);
    assert.equal(header.format, format);
    assert.equal(header.width, 120, `${format} : largeur`);
    assert.equal(header.height, 80, `${format} : hauteur`);
  }
  assert.equal(inspectImageHeader(HTML_ERROR).ok, false);
});

// ══════════════════════════════════════════════════════════════════════════
// D. Le handler journalise CHAQUE refus
// ══════════════════════════════════════════════════════════════════════════

const PNG_ATTACHMENT = { contentType: "image/png", size: 1024, url: "https://cdn/i.png" };

test("Handler — le refus de métadonnées est journalisé avec contentType, taille et limite", async () => {
  const context = uploadContext({ attachment: { contentType: "application/pdf", size: 2048, url: "https://cdn/i.pdf" } });
  const result = await uploadWelcomeImage(context);
  assert.equal(result.reason, R.UNSUPPORTED_FORMAT);
  const logged = context.logs.find((l) => l.message === "Welcome image upload rejected");
  assert.ok(logged);
  assert.equal(logged.guildId, GUILD_A);
  assert.equal(logged.actorId, "999999999999999999");
  assert.equal(logged.reason, R.UNSUPPORTED_FORMAT);
  assert.equal(logged.detail.contentType, "application/pdf");
  assert.equal(logged.detail.size, 2048);
  assert.equal(logged.detail.limit, 25 * 1024 * 1024);
});

test("Handler — le refus Premium est journalisé et n'écrit toujours rien", async () => {
  const storage = createStorageFake();
  const context = uploadContext({ storage, attachment: PNG_ATTACHMENT, granted: false, code: "PREMIUM_REQUIRED" });
  const result = await uploadWelcomeImage(context);
  assert.equal(result.code, "PREMIUM_REQUIRED");
  assert.equal(context.logs.some((l) => l.message === "Welcome image upload refused by entitlement"), true);
  assert.deepEqual(context.settings.updates, []);
  assert.equal(storage.calls.length, 0);
});

test("Handler — le stockage indisponible est journalisé", async () => {
  const context = uploadContext({ attachment: PNG_ATTACHMENT });
  context.imageStore = new WelcomeImageStore();
  const result = await uploadWelcomeImage(context);
  assert.equal(result.code, "WELCOME_IMAGE_STORAGE_UNAVAILABLE");
  assert.equal(context.logs.some((l) => l.message === "Welcome image upload rejected: storage unavailable"), true);
  assert.deepEqual(context.settings.updates, []);
});

test("Handler — l'échec d'écriture dans le bucket est journalisé avec la cause", async () => {
  const storage = createStorageFake();
  storage.from = () => ({ async upload() { throw new Error("row-level security blocks write"); } });
  const context = uploadContext({ storage, attachment: PNG_ATTACHMENT });
  const result = await withFetch(async () => response(png(), { contentType: "image/png" }), () => uploadWelcomeImage(context));
  assert.equal(result.code, "WELCOME_IMAGE_STORAGE_UNAVAILABLE");
  const logged = context.logs.find((l) => l.message === "Welcome image storage upload failed");
  assert.ok(logged);
  assert.equal(logged.causeMessage, "row-level security blocks write", "la cause d'origine traverse l'enveloppe");
  assert.deepEqual(context.settings.updates, [], "la clé n'est pas écrite si l'objet n'est pas stocké");
});

test("Handler — cas réel reproduit : CDN filtré, message distinct et cause complète dans les logs", async () => {
  const storage = createStorageFake();
  const context = uploadContext({ storage, attachment: { ...PNG_ATTACHMENT, size: HTML_ERROR.length } });

  const result = await withFetch(async () => response(HTML_ERROR, { contentType: "text/html" }), () => uploadWelcomeImage(context));

  assert.equal(result.reason, R.CDN_UNEXPECTED_CONTENT);
  // Le message utilisateur n'accuse plus le fichier.
  assert.equal(context.transportCalls[0].content, "welcomeGoodbye.welcomeImageRejectCdn");
  // Et la cause exacte est observable dans la console du hosting.
  const rejection = context.logs.find((l) => l.message === "Welcome image upload rejected");
  assert.equal(rejection.reason, R.CDN_UNEXPECTED_CONTENT);
  assert.equal(rejection.guildId, GUILD_A);
  assert.equal(rejection.detail.httpContentType, "text/html");
  assert.ok(rejection.detail.preview.includes("blocked by proxy"), "le contenu reçu est identifiable");
  assert.deepEqual(context.settings.updates, []);
  assert.equal(storage.calls.filter((c) => c.op === "upload").length, 0);
});

test("Handler — succès : aucun log de refus, upload et clé écrits", async () => {
  const image = png();
  const storage = createStorageFake();
  const context = uploadContext({ storage, attachment: { contentType: "image/png", size: image.length, url: "https://cdn/i.png" } });
  const result = await withFetch(async () => response(image, { contentType: "image/png" }), () => uploadWelcomeImage(context));

  assert.equal(result.code, "WELCOME_IMAGE_UPLOADED");
  assert.equal(context.logs.filter((l) => l.message === "Welcome image upload rejected").length, 0);
  assert.deepEqual(context.settings.updates, [{ guildId: GUILD_A, patch: { [Key.WELCOME_IMAGE_KEY]: KEY_A } }]);
  assert.equal(storage.calls.filter((c) => c.op === "upload").length, 1);
  assert.equal(context.adminCalls.length, 1);
});

// ══════════════════════════════════════════════════════════════════════════
// E. Chaque raison a un message distinct — garde-fou anti-message trompeur
// ══════════════════════════════════════════════════════════════════════════

test("Messages — les 9 raisons produisent 9 messages distincts", async () => {
  const fr = require("../translations/fr.json").welcomeGoodbye;
  const src = require("node:fs").readFileSync(require.resolve("../interactions/welcomeImageUpload"), "utf8");
  const keys = new Set();
  for (const reason of Object.values(R)) {
    const match = src.match(new RegExp(`WelcomeImageRejectReason\\.${reason}\\]:\\s*"welcomeGoodbye\\.([^"]+)"`));
    assert.ok(match, `${reason} doit avoir une clé de message`);
    assert.ok(fr[match[1]], `la clé ${match[1]} doit exister en FR`);
    keys.add(match[1]);
  }
  assert.equal(keys.size, Object.values(R).length, "aucune raison ne partage le message d'une autre");
  assert.notEqual(fr.welcomeImageRejectNotAnImage, fr.welcomeImageRejectCdn,
    "« fichier invalide » et « CDN filtré » doivent rester distinguables");
  assert.notEqual(fr.welcomeImageRejectNotAnImage, fr.welcomeImageRejectDecode);
});

// ══════════════════════════════════════════════════════════════════════════
// F. Protections inchangées
// ══════════════════════════════════════════════════════════════════════════

test("Protections — Premium, toggle, dimensions et isolation restent intacts", async () => {
  // 1. Premium refusé ⇒ aucune I/O
  const free = uploadContext({ attachment: PNG_ATTACHMENT, granted: false, code: "PREMIUM_REQUIRED" });
  assert.equal((await uploadWelcomeImage(free)).code, "PREMIUM_REQUIRED");
  assert.deepEqual(free.settings.updates, []);

  // 2. Entitlement indisponible ⇒ fail-closed
  const unavailable = uploadContext({ attachment: PNG_ATTACHMENT, granted: false, code: "ENTITLEMENT_UNAVAILABLE" });
  assert.equal((await uploadWelcomeImage(unavailable)).code, "ENTITLEMENT_UNAVAILABLE");
  assert.deepEqual(unavailable.settings.updates, []);

  // 3. Taille au-dessus de la limite de l'interaction
  const tooLarge = uploadContext({ attachment: { contentType: "image/png", size: 30 * 1024 * 1024, url: "https://cdn/i.png" } });
  assert.equal((await uploadWelcomeImage(tooLarge)).reason, R.TOO_LARGE);

  // 4. La clé écrite reste strictement celle de la guilde
  const image = png();
  const storage = createStorageFake();
  const ok = uploadContext({ storage, attachment: { contentType: "image/png", size: image.length, url: "https://cdn/i.png" } });
  await withFetch(async () => response(image, { contentType: "image/png" }), () => uploadWelcomeImage(ok));
  assert.equal(storage.calls[0].name, `${GUILD_A}/welcome.png`);
  assert.equal(ok.settings.updates[0].patch[Key.WELCOME_IMAGE_KEY], `${GUILD_A}/welcome.png`);
  assert.equal(checkWelcomeImageAttachment({ attachment: { contentType: "image/png", size: 10 }, attachmentSizeLimit: 5 }).reason, R.TOO_LARGE);
});

// ══════════════════════════════════════════════════════════════════════════
// G. Flux réel : vrai serveur HTTP + vrai fetch
// ══════════════════════════════════════════════════════════════════════════

test("Flux réel — un vrai PNG servi en HTTP traverse tout le chemin et est stocké", async () => {
  const image = png(320, 180);
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "image/png", "Content-Length": image.length });
    res.end(image);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/welcome.png`;

  try {
    const storage = createStorageFake();
    const context = uploadContext({ storage, attachment: { contentType: "image/png", size: image.length, url } });
    const result = await uploadWelcomeImage(context);

    assert.equal(result.code, "WELCOME_IMAGE_UPLOADED");
    assert.equal(result.width, 320);
    assert.equal(result.height, 180);
    assert.equal(storage.objects.get(KEY_A).equals(image), true, "les octets stockés sont ceux du fichier");
    assert.equal(context.logs.filter((l) => l.level === "warn").length, 0, "aucun avertissement sur le chemin nominal");
  } finally {
    server.close();
  }
});

test("Flux réel — un proxy qui renvoie du HTML sur les deux URL produit CDN_UNEXPECTED_CONTENT", async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html", "Content-Length": HTML_ERROR.length });
    res.end(HTML_ERROR);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const storage = createStorageFake();
    const context = uploadContext({
      storage,
      attachment: { contentType: "image/png", size: HTML_ERROR.length, url: `${base}/cdn.png`, proxyURL: `${base}/proxy.png` },
    });
    const result = await uploadWelcomeImage(context);

    assert.equal(result.reason, R.CDN_UNEXPECTED_CONTENT);
    assert.equal(storage.calls.filter((c) => c.op === "upload").length, 0);
    assert.deepEqual(context.settings.updates, []);
    assert.equal(context.logs.filter((l) => l.message === "Welcome image download attempt failed").length, 2,
      "les deux tentatives sont visibles dans la console");
  } finally {
    server.close();
  }
});
