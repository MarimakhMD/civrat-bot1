"use strict";

/**
 * Compatibilité du décodeur natif (@napi-rs/canvas) avec les images réellement
 * envoyées depuis Discord.
 *
 * Deux défauts distincts de la v1.0.3 sont épinglés ici, tous deux reproduits
 * par exécution et corrigés en v1.0.9 :
 *
 * 1. Faux positif SVG. `is_svg_image()` cherchait la séquence littérale `<svg`
 *    (sensible à la casse) SUR TOUT LE BUFFER, et non en tête de fichier. Toute
 *    image contenant ces 4 octets — typiquement un PNG exporté par Inkscape,
 *    qui embarque la source SVG dans un chunk `iTXt` — était aiguillée vers le
 *    décodeur SVG (resvg) et rejetée avec « Invalid SVG image ». Le fichier
 *    était parfaitement valide : notre propre lecture d'en-tête y trouvait les
 *    bonnes dimensions. Les 5 formats étaient touchés.
 *
 * 2. SIGSEGV. Un PNG à signature valide mais en-tête incohérent tuait le
 *    processus (signal 11) ; un try/catch ne peut pas intercepter un signal.
 *
 * Le plancher de version est donc une exigence de sécurité, pas un détail :
 * un retour en arrière réintroduirait les deux défauts.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("node:zlib");
const { createCanvas, loadImage } = require("@napi-rs/canvas");

const {
  decodeWelcomeImage,
  inspectImageHeader,
  WelcomeImageRejectReason: R,
} = require("../services/welcomeImageUploadValidation");

/** Première version exempte des deux défauts décrits ci-dessus. */
const MIN_SAFE_CANVAS_VERSION = "1.0.9";

/** Comparaison semver minimale : -1 si a<b, 0 si égaux, 1 si a>b. */
function compareVersions(a, b) {
  const pa = String(a).split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pb = String(b).split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) < (pb[i] || 0) ? -1 : 1;
  }
  return 0;
}

function installedCanvasVersion() {
  // Résolu depuis node_modules plutôt que depuis package.json : c'est le
  // binaire réellement chargé à l'exécution qui compte.
  return require("@napi-rs/canvas/package.json").version;
}

/** Construit un chunk PNG valide (longueur, type, données, CRC). */
function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBytes = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([typeBytes, data])) >>> 0, 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

function sampleCanvas(width = 240, height = 160) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#2e86ab";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "rgba(255, 214, 10, 0.85)";
  ctx.fillRect(30, 30, 80, 50);
  return canvas;
}

const MIME_BY_FORMAT = {
  png: "image/png",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
};

function bufferFor(format) {
  return sampleCanvas().toBuffer(MIME_BY_FORMAT[format]);
}

/** Insère un chunk de texte avant le premier IDAT, comme le font les vrais exporteurs. */
function pngWithTextChunk(keyword, text) {
  const png = bufferFor("png");
  const at = png.indexOf("IDAT") - 4;
  const payload = Buffer.concat([Buffer.from(`${keyword}\0`, "latin1"), Buffer.from(text, "latin1")]);
  return Buffer.concat([png.subarray(0, at), pngChunk("tEXt", payload), png.subarray(at)]);
}

/** Insère un chunk iTXt (UTF-8) — le format utilisé par Inkscape et Adobe XMP. */
function pngWithITextChunk(keyword, text) {
  const png = bufferFor("png");
  const at = png.indexOf("IDAT") - 4;
  const payload = Buffer.concat([
    Buffer.from(`${keyword}\0`, "latin1"),
    Buffer.from([0, 0]), // compression: aucune / aucune méthode
    Buffer.from("\0", "latin1"), // pas de langue
    Buffer.from("\0", "latin1"), // pas de texte traduit
    Buffer.from(text, "utf8"),
  ]);
  return Buffer.concat([png.subarray(0, at), pngChunk("iTXt", payload), png.subarray(at)]);
}

const EMBEDDED_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160"><rect width="240" height="160"/></svg>';

// ─────────────────────────────────────────────────────────────────────────────
// A. Plancher de version du décodeur
// ─────────────────────────────────────────────────────────────────────────────

test("Décodeur — la version installée est au-dessus du plancher de sécurité", () => {
  const installed = installedCanvasVersion();
  assert.ok(
    compareVersions(installed, MIN_SAFE_CANVAS_VERSION) >= 0,
    `@napi-rs/canvas ${installed} est antérieur à ${MIN_SAFE_CANVAS_VERSION}. ` +
      "Les versions antérieures rejettent à tort toute image contenant les octets « <svg » " +
      "et tuent le processus (SIGSEGV) sur un en-tête PNG incohérent.",
  );
});

test("Décodeur — package.json déclare le même plancher que le test", () => {
  const declared = require("../../../../package.json").dependencies["@napi-rs/canvas"];
  assert.ok(declared, "@napi-rs/canvas doit rester une dépendance directe");
  const floor = declared.replace(/[\^~>=<\s]/g, "");
  assert.ok(
    compareVersions(floor, MIN_SAFE_CANVAS_VERSION) >= 0,
    `package.json déclare ${declared}, ce qui autoriserait une version vulnérable`,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// B. Faux positif « Invalid SVG image »
// ─────────────────────────────────────────────────────────────────────────────

test("Décodeur — un PNG embarquant du SVG dans un chunk tEXt se décode (faux positif corrigé)", async () => {
  const buffer = pngWithTextChunk("SVG", EMBEDDED_SVG);

  // Le fichier est structurellement valide : notre lecture d'en-tête le prouve.
  const header = inspectImageHeader(buffer);
  assert.equal(header.ok, true, "l'en-tête est lisible, le fichier n'est pas corrompu");
  assert.equal(header.format, "png");
  assert.equal(header.width, 240);
  assert.equal(header.height, 160);

  const result = await decodeWelcomeImage(buffer, {});
  assert.equal(result.ok, true, `attendu : décodage réussi, obtenu ${result.reason}`);
  assert.equal(result.width, 240);
  assert.equal(result.height, 160);
  assert.equal(result.format, "png");
});

test("Décodeur — un PNG embarquant du SVG dans un chunk iTXt (Inkscape) se décode", async () => {
  const buffer = pngWithITextChunk("Inkscape:SVG", EMBEDDED_SVG);
  const result = await decodeWelcomeImage(buffer, {});
  assert.equal(result.ok, true, `attendu : décodage réussi, obtenu ${result.reason}`);
});

test("Décodeur — les 5 formats supportés se décodent même avec « <svg » dans le fichier", async () => {
  const needle = Buffer.from("<svg", "ascii");

  for (const [format, mime] of Object.entries(MIME_BY_FORMAT)) {
    const clean = sampleCanvas().toBuffer(mime);
    const contaminated = Buffer.concat([clean, needle]);

    // Contrôle : la version propre doit passer, sinon le test ne prouve rien.
    const baseline = await decodeWelcomeImage(clean, {});
    assert.equal(baseline.ok, true, `${format} : la version propre doit se décoder`);

    const result = await decodeWelcomeImage(contaminated, {});
    assert.equal(result.ok, true, `${format} : la présence de « <svg » ne doit pas faire échouer le décodage`);
    assert.equal(result.width, baseline.width, `${format} : dimensions identiques`);
    assert.equal(result.height, baseline.height, `${format} : dimensions identiques`);
  }
});

test("Décodeur — la détection ne confond pas majuscules ni variantes approchantes", async () => {
  // En 1.0.3 la recherche était sensible à la casse et sans tolérance
  // d'espace : seule la séquence exacte « <svg » déclenchait le faux positif.
  // Ces variantes passaient déjà ; elles doivent continuer à passer.
  const variants = [
    "<SVG xmlns='http://www.w3.org/2000/svg'/>",
    "<Svg/>",
    "< svg/>",
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<!DOCTYPE svg PUBLIC '-//W3C//DTD SVG 1.1//EN'>",
    'xmlns="http://www.w3.org/2000/svg"',
    "une simple description sans balise",
  ];

  for (const text of variants) {
    const buffer = pngWithTextChunk("Description", text);
    const result = await decodeWelcomeImage(buffer, {});
    assert.equal(result.ok, true, `variante non décodée : ${text}`);
  }
});

test("Décodeur — un métadonnée XMP Adobe ne perturbe pas le décodage", async () => {
  const xmp = [
    '<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>',
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
    '  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    '    <rdf:Description rdf:about="" dc:format="image/png"/>',
    "  </rdf:RDF>",
    "</x:xmpmeta>",
    '<?xpacket end="w"?>',
  ].join("\n");

  const result = await decodeWelcomeImage(pngWithITextChunk("XML:com.adobe.xmp", xmp), {});
  assert.equal(result.ok, true, `XMP : attendu décodage réussi, obtenu ${result.reason}`);
});

test("Décodeur — un vrai SVG reste décodable (le correctif ne casse pas SVG)", async () => {
  // loadImage doit continuer à reconnaître un SVG authentique : le correctif
  // porte sur le faux positif, pas sur le support SVG lui-même.
  const svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="#f00"/></svg>',
    "utf8",
  );
  const image = await loadImage(svg);
  assert.equal(image.width, 40);
  assert.equal(image.height, 20);
});

// ─────────────────────────────────────────────────────────────────────────────
// C. En-tête incohérent : refus propre au lieu d'un crash de processus
// ─────────────────────────────────────────────────────────────────────────────

test("Décodeur — un en-tête PNG incohérent est refusé sans tuer le processus", async () => {
  const valid = bufferFor("png");
  const traps = [
    ["hauteur nulle", (() => { const b = Buffer.from(valid); b.writeUInt32BE(0, 20); return b; })()],
    ["bitDepth hors jeu", (() => { const b = Buffer.from(valid); b[24] = 99; return b; })()],
    ["colorType hors jeu", (() => { const b = Buffer.from(valid); b[25] = 99; return b; })()],
    ["aucun chunk IDAT", (() => {
      const at = valid.indexOf("IDAT");
      return Buffer.concat([valid.subarray(0, at - 4), valid.subarray(valid.length - 12)]);
    })()],
    ["signature puis octets aléatoires", Buffer.concat([valid.subarray(0, 8), Buffer.from(Array.from({ length: 512 }, () => 0x42))])],
  ];

  for (const [label, buffer] of traps) {
    const result = await decodeWelcomeImage(buffer, {});
    assert.equal(result.ok, false, `${label} : doit être refusé`);
    assert.equal(result.reason, R.NOT_AN_IMAGE, `${label} : refus propre attendu, obtenu ${result.reason}`);
  }
});

test("Décodeur — loadImage lève une erreur exploitable au lieu d'un signal", async () => {
  const valid = bufferFor("png");
  const trap = Buffer.from(valid);
  trap.writeUInt32BE(0, 20);

  // En 1.0.3 cet appel tuait le processus. S'il le fait à nouveau, la suite de
  // tests s'arrête ici — c'est le signal voulu.
  await assert.rejects(() => loadImage(trap), (error) => {
    assert.ok(error instanceof Error, "une Error JS est levée, pas un signal");
    assert.equal(typeof error.message, "string");
    assert.ok(error.message.length > 0, "le message d'erreur est exploitable dans les logs");
    return true;
  });
});

test("Décodeur — la bombe de pixels déclarée dans l'IHDR est bloquée avant décodage", async () => {
  const valid = bufferFor("png");
  const bomb = Buffer.from(valid);
  bomb.writeUInt32BE(0x7fffffff, 16);

  const result = await decodeWelcomeImage(bomb, {});
  assert.equal(result.reason, R.TOO_MANY_PIXELS);
  assert.equal(result.detail.width, 0x7fffffff);
});

test("Décodage — un PNG structurellement sain mais sémantiquement invalide donne DECODE_FAILED", async () => {
  // colorType 3 (palette) impose un chunk PLTE. L'IHDR et la chaîne de chunks
  // sont parfaitement cohérents — la garde d'en-tête accepte donc le fichier à
  // raison, puisqu'elle ne valide pas la sémantique — mais le décodeur échoue.
  // C'est précisément la distinction que DECODE_FAILED existe pour porter.
  const logger = { logs: [], warn(message, context) { this.logs.push({ message, ...context }); } };

  const raw = Buffer.alloc(9 * 8, 0x80);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(8, 0);
  ihdr.writeUInt32BE(8, 4);
  ihdr[8] = 8;   // bitDepth
  ihdr[9] = 3;   // colorType : palette
  const buffer = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);

  assert.equal(inspectImageHeader(buffer).ok, true, "la garde ne valide pas la sémantique, c'est attendu");

  const result = await decodeWelcomeImage(buffer, { logger, guildId: "1320817768962064384" });
  assert.equal(result.ok, false);
  assert.equal(result.reason, R.DECODE_FAILED, `attendu DECODE_FAILED, obtenu ${result.reason}`);
  assert.equal(result.detail.format, "png");
  assert.equal(typeof result.detail.errorMessage, "string");
  assert.ok(result.detail.errorMessage.length > 0, "la cause du décodeur est conservée");
  const logged = logger.logs.find((l) => l.message === "Welcome image decode failed");
  assert.ok(logged, "l'échec est journalisé");
  assert.equal(logged.guildId, "1320817768962064384");
});

// ─────────────────────────────────────────────────────────────────────────────
// D. Cohérence entre notre garde d'en-tête et le décodeur natif
// ─────────────────────────────────────────────────────────────────────────────

test("Garde d'en-tête — aucun faux refus sur les PNG réellement produits", async () => {
  // Toute image que notre garde accepte doit aussi se décoder, et réciproquement
  // sur ce corpus : un écart dans un sens ou dans l'autre trahirait une dérive.
  const canvas = sampleCanvas(128, 96);
  const corpus = Object.values(MIME_BY_FORMAT).map((mime) => canvas.toBuffer(mime));

  // PNG construits à la main dans chaque combinaison IHDR valide.
  const handmade = (width, height, bitDepth, colorType, bytesPerRow, interlace, extraChunks = []) => {
    const raw = Buffer.alloc((bytesPerRow + 1) * height, 0x80);
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = bitDepth;
    ihdr[9] = colorType;
    ihdr[12] = interlace;
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      pngChunk("IHDR", ihdr),
      ...extraChunks,
      pngChunk("IDAT", zlib.deflateSync(raw)),
      pngChunk("IEND", Buffer.alloc(0)),
    ]);
  };
  // La spec PNG impose un chunk PLTE pour colorType 3 ; sans lui le fichier est
  // réellement invalide et n'a rien à faire dans un corpus de fichiers sains.
  const palette = pngChunk("PLTE", Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255]));
  corpus.push(
    handmade(8, 8, 8, 0, 8),              // grayscale
    handmade(8, 8, 8, 2, 24),             // RGB
    handmade(8, 8, 8, 3, 8, 0, [palette]),// palette
    handmade(8, 8, 8, 4, 16),             // grayscale + alpha
    handmade(8, 8, 8, 6, 32),             // RGBA
    handmade(8, 8, 16, 6, 64),            // RGBA 16 bits
    handmade(8, 8, 16, 2, 48),            // RGB 16 bits
    handmade(8, 8, 8, 6, 32, 1),          // interlacé Adam7
  );

  for (const buffer of corpus) {
    const header = inspectImageHeader(buffer);
    assert.equal(header.ok, true, `faux refus de la garde d'en-tête : ${header.reason}`);
    const result = await decodeWelcomeImage(buffer, {});
    assert.equal(result.ok, true, `accepté par la garde mais non décodable : ${result.reason}`);
    assert.equal(result.width, header.width, "la garde et le décodeur voient la même largeur");
    assert.equal(result.height, header.height, "la garde et le décodeur voient la même hauteur");
  }
});

test("Garde d'en-tête — les fonds de gabarit du dépôt restent acceptés", () => {
  // Garde-fou concret : si la garde se mettait à rejeter un PNG réel, le rendu
  // des cartes Welcome cassées passerait inaperçu en test unitaire.
  const fs = require("node:fs");
  const path = require("node:path");
  const templatesDir = path.join(__dirname, "..", "templates");

  const found = [];
  for (const entry of fs.readdirSync(templatesDir)) {
    const candidate = path.join(templatesDir, entry, "background.png");
    if (fs.existsSync(candidate)) found.push([entry, candidate]);
  }
  assert.ok(found.length >= 3, `fonds de gabarit introuvables dans ${templatesDir}`);

  for (const [name, file] of found) {
    const header = inspectImageHeader(fs.readFileSync(file));
    assert.equal(header.ok, true, `${name} : refusé par la garde (${header.reason})`);
    assert.equal(header.format, "png");
    assert.ok(header.width > 0 && header.height > 0, `${name} : dimensions invalides`);
  }
});
