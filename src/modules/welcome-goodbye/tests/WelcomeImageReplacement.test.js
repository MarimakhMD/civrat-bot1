"use strict";

/**
 * Régression : le REMPLACEMENT d'une image Welcome.
 *
 * Le bug : la clé d'objet est CONSTANTE par guilde (`{guildId}/welcome.png`),
 * donc l'image A et son remplacement B occupent la MÊME entrée du
 * `WelcomeResourceCache` (TTL 300 s). Rien n'invalidait cette entrée : après un
 * remplacement, le rendu continuait de servir A pendant toute la durée du TTL.
 *
 * Aggravation : la production compose DEUX runtimes, chacun avec son propre
 * cache (panneau d'administration et livraison). Une invalidation limitée au
 * panneau laissait la vraie carte Welcome servie sur l'ancienne image.
 *
 * Ces tests prouvent le correctif par SHA-256 : on compare l'empreinte du
 * buffer réellement injecté dans le template à celle des images d'origine.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { createCanvas } = require("@napi-rs/canvas");

const { WelcomeImageStore } = require("../services/WelcomeImageStore");
const { WelcomeResourceCache } = require("../rendering/WelcomeResourceCache");
const { WelcomeTemplateRegistry } = require("../rendering/WelcomeTemplateRegistry");
const { resolveWelcomeImageTemplate } = require("../services/welcomeImageResource");
const { uploadWelcomeImage } = require("../interactions/welcomeImageUpload");
const { removeWelcomeImage } = require("../interactions/welcomeImageActions");
const { WelcomeGoodbyeConfigKey: Key } = require("../configuration/welcomeGoodbyeConstants");

const GUILD_A = "111111111111111111";
const GUILD_B = "222222222222222222";
const IMAGE_KEY_A = `${GUILD_A}/welcome.png`;
const META_KEY_A = `${GUILD_A}/welcome.json`;

// Mêmes dimensions que le cas réel signalé, pour reproduire le scénario.
function solidImage(width, height, rgb) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = `rgb(${rgb.join(",")})`;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(width * 0.15, height * 0.2, width * 0.2, height * 0.6);
  return canvas.toBuffer("image/png");
}

const IMAGE_A = solidImage(2172, 724, [200, 30, 30]);
const IMAGE_B = solidImage(738, 270, [30, 60, 200]);

const sha256 = (buffer) => (buffer ? crypto.createHash("sha256").update(buffer).digest("hex") : null);
const SHA_A = sha256(IMAGE_A);
const SHA_B = sha256(IMAGE_B);

function baseTemplate() {
  const registry = new WelcomeTemplateRegistry();
  registry.discover();
  return registry.get("template-1");
}

/** Bucket en mémoire à sémantique Supabase : upsert remplace, remove supprime. */
function createBucket(seed = {}) {
  const objects = new Map(Object.entries(seed));
  const calls = [];
  return {
    objects,
    calls,
    from(name) {
      return {
        async upload(objectName, buffer, opts = {}) {
          calls.push({ op: "upload", bucket: name, objectName, options: opts });
          if (objects.has(objectName) && !opts.upsert) return { error: { message: "duplicate" } };
          objects.set(objectName, Buffer.from(buffer));
          return { error: null };
        },
        async download(objectName) {
          calls.push({ op: "download", bucket: name, objectName });
          const value = objects.get(objectName);
          return value
            ? { data: value, error: null }
            : { data: null, error: { message: "Object not found", status: 404, statusCode: "404" } };
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

function createLogger() {
  const logs = [];
  return {
    logs,
    info: (message, data) => logs.push({ level: "info", message, ...data }),
    warn: (message, data) => logs.push({ level: "warn", message, ...data }),
  };
}

function createSettingsFake() {
  const updates = [];
  let key = null;
  return {
    updates,
    async get() {
      return { language: "fr", [Key.WELCOME_IMAGE_ENABLED]: true, [Key.WELCOME_TEMPLATE]: "template-1", [Key.WELCOME_IMAGE_KEY]: key };
    },
    async update(guildId, patch) {
      updates.push({ guildId, patch });
      if (Key.WELCOME_IMAGE_KEY in patch) key = patch[Key.WELCOME_IMAGE_KEY];
      return this.get();
    },
    get key() { return key; },
  };
}

function createTransportFake() {
  const calls = [];
  return {
    calls,
    async replyImagePreview(payload) { calls.push({ kind: "imagePreview", bytes: payload?.buffer?.length ?? null }); return {}; },
    async reply() { return {}; },
    async update() { return {}; },
  };
}

function attachmentFor(buffer) {
  return { contentType: "image/png", size: buffer.length, url: "https://cdn/welcome.png", name: "welcome.png" };
}

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

/**
 * Scénario complet : un bucket, un store, un cache (ou plusieurs, pour imiter
 * les deux runtimes de production), des settings partagés.
 */
function scenario({ caches = 1 } = {}) {
  const bucket = createBucket();
  const imageStore = new WelcomeImageStore({ storage: bucket });
  const settings = createSettingsFake();
  const cacheInstances = Array.from({ length: caches }, () => new WelcomeResourceCache());
  return {
    bucket,
    imageStore,
    settings,
    cacheInstances,
    // Le panneau et la livraison utilisent chacun LEUR cache.
    panelCache: cacheInstances[0],
    deliveryCache: cacheInstances[caches - 1],
    logger: createLogger(),

    async upload(buffer, cache = this.panelCache) {
      return withFetch(buffer, () => uploadWelcomeImage({
        guildId: GUILD_A,
        userId: "999999999999999999",
        t: (k) => k,
        envelope: {
          transport: createTransportFake(),
          discordMember: null,
          attachmentSizeLimit: 10 * 1024 * 1024,
          options: { getAttachment: () => attachmentFor(buffer) },
        },
        settings,
        imageStore,
        imagePipeline: null,
        templateRegistry: null,
        resourceCache: cache,
        adminLogService: { record: () => {} },
        entitlementService: { async requireFeature() { return { ok: true, granted: true, code: "GRANTED" }; } },
        logger: this.logger,
      }));
    },

    async remove() {
      return removeWelcomeImage({
        guildId: GUILD_A,
        t: (k) => k,
        envelope: { transport: createTransportFake() },
        settings,
        imageStore,
        entitlementService: { async requireFeature() { return { ok: true, granted: true, code: "GRANTED" }; } },
        logger: this.logger,
      });
    },

    /** Le rendu, via le cache demandé — celui du panneau ou celui de la livraison. */
    async render(cache = this.deliveryCache) {
      const template = baseTemplate();
      const resolved = await resolveWelcomeImageTemplate({
        baseTemplate: template,
        config: await settings.get(),
        guildId: GUILD_A,
        entitlement: { granted: true },
        imageStore,
        resourceCache: cache,
        logger: this.logger,
      });
      const buffer = resolved?.design?.background?.buffer || null;
      return {
        buffer,
        sha256: sha256(buffer),
        isTemplate: resolved === template,
        geometry: resolved?.design?.avatar || null,
      };
    },
  };
}

function whichImage(sha) {
  if (sha === SHA_A) return "IMAGE A";
  if (sha === SHA_B) return "IMAGE B";
  return sha ? "INCONNU" : "AUCUNE";
}

// ══════════════════════════════════════════════════════════════════════════
// A. Le scénario réel, prouvé par SHA-256
// ══════════════════════════════════════════════════════════════════════════

test("Remplacement A → B — le rendu sert B, prouvé par SHA-256", async () => {
  assert.notEqual(SHA_A, SHA_B, "précondition : les deux images doivent être distinguables");

  const s = scenario({ caches: 2 });

  // 1. Upload de A.
  const uploadedA = await s.upload(IMAGE_A);
  assert.equal(uploadedA.ok, true, `upload A refusé : ${uploadedA.code}`);
  assert.equal(uploadedA.width, 2172);
  assert.equal(uploadedA.height, 724);
  assert.equal(uploadedA.bytes, IMAGE_A.length);
  assert.equal(s.settings.key, IMAGE_KEY_A, "welcome_image_key doit pointer sur la clé de la guilde");

  let rendered = await s.render();
  assert.equal(rendered.sha256, SHA_A, `après upload A, le rendu doit servir A (${whichImage(rendered.sha256)})`);

  // 2. Suppression de A puis upload de B.
  await s.remove();
  const uploadedB = await s.upload(IMAGE_B);
  assert.equal(uploadedB.ok, true, `upload B refusé : ${uploadedB.code}`);
  assert.equal(uploadedB.width, 738);
  assert.equal(uploadedB.height, 270);
  assert.equal(uploadedB.bytes, IMAGE_B.length);

  // La clé est IDENTIQUE : c'est précisément ce qui rendait le cache aveugle.
  assert.equal(s.settings.key, IMAGE_KEY_A, "la clé ne change pas entre A et B — c'est la racine du bug");
  assert.equal(sha256(s.bucket.objects.get(IMAGE_KEY_A)), SHA_B, "le bucket contient bien B");

  // 3. LE TEST : le rendu doit servir B, pas A.
  rendered = await s.render();
  assert.equal(rendered.isTemplate, false, "l'image personnalisée doit être injectée");
  assert.equal(rendered.sha256, SHA_B,
    `après remplacement, le rendu servait ${whichImage(rendered.sha256)} au lieu de IMAGE B`);
});

test("Remplacement A → B — la LIVRAISON (second cache) sert B elle aussi", async () => {
  // La production compose deux runtimes : le panneau d'administration et la
  // livraison des cartes Welcome. N'invalider que le cache du panneau
  // laisserait la vraie carte Welcome sur l'ancienne image.
  const s = scenario({ caches: 2 });
  assert.notEqual(s.panelCache, s.deliveryCache, "précondition : deux caches distincts");

  await s.upload(IMAGE_A);
  assert.equal((await s.render(s.panelCache)).sha256, SHA_A, "le cache du panneau sert A");
  assert.equal((await s.render(s.deliveryCache)).sha256, SHA_A, "le cache de livraison sert A");

  await s.upload(IMAGE_B);

  assert.equal((await s.render(s.panelCache)).sha256, SHA_B, "le cache du panneau doit servir B");
  assert.equal((await s.render(s.deliveryCache)).sha256, SHA_B,
    "l'invalidation doit atteindre le cache de LIVRAISON, pas seulement celui du panneau");
});

test("Suppression — le rendu retombe sur le gabarit, pas sur l'image supprimée", async () => {
  const s = scenario({ caches: 2 });
  await s.upload(IMAGE_A);
  assert.equal((await s.render()).sha256, SHA_A);

  const result = await s.remove();
  assert.equal(result.removed, true);
  assert.equal(s.bucket.objects.has(IMAGE_KEY_A), false, "l'objet a disparu du bucket");

  for (const cache of s.cacheInstances) {
    const rendered = await s.render(cache);
    assert.equal(rendered.isTemplate, true, "après suppression, le gabarit standard doit être servi");
    assert.equal(rendered.sha256, null, "aucun buffer personnalisé ne doit subsister");
  }
});

test("Cycle complet A → B → suppression → A", async () => {
  const s = scenario({ caches: 2 });

  await s.upload(IMAGE_A);
  assert.equal((await s.render()).sha256, SHA_A, "étape 1 : A");

  await s.upload(IMAGE_B);
  assert.equal((await s.render()).sha256, SHA_B, "étape 2 : B remplace A");

  await s.remove();
  assert.equal((await s.render()).isTemplate, true, "étape 3 : gabarit");

  await s.upload(IMAGE_A);
  assert.equal((await s.render()).sha256, SHA_A, "étape 4 : A de nouveau, et non B");
});

// ══════════════════════════════════════════════════════════════════════════
// B. Le mécanisme d'invalidation
// ══════════════════════════════════════════════════════════════════════════

test("invalidateEverywhere — atteint toutes les instances vivantes", () => {
  const one = new WelcomeResourceCache();
  const two = new WelcomeResourceCache();
  one.set(IMAGE_KEY_A, IMAGE_A);
  two.set(IMAGE_KEY_A, IMAGE_A);

  const touched = WelcomeResourceCache.invalidateEverywhere(IMAGE_KEY_A);

  assert.equal(one.get(IMAGE_KEY_A), null, "instance 1 vidée");
  assert.equal(two.get(IMAGE_KEY_A), null, "instance 2 vidée");
  assert.ok(touched >= 2, `au moins les deux instances créées doivent être touchées (${touched})`);
});

test("invalidateEverywhere — n'atteint pas les autres guildes", () => {
  const cache = new WelcomeResourceCache();
  const keyB = `${GUILD_B}/welcome.png`;
  cache.set(IMAGE_KEY_A, IMAGE_A);
  cache.set(keyB, IMAGE_B);

  WelcomeResourceCache.invalidateEverywhere(IMAGE_KEY_A);

  assert.equal(cache.get(IMAGE_KEY_A), null, "la guilde A est invalidée");
  assert.equal(sha256(cache.get(keyB)), SHA_B, "la guilde B ne doit pas être affectée");
});

test("L'upload invalide le cache — prouvé par l'absence de nouvelle lecture inutile", async () => {
  const s = scenario();
  await s.upload(IMAGE_A);
  await s.render(s.panelCache);
  assert.ok(s.panelCache.get(IMAGE_KEY_A), "précondition : l'entrée est en cache");

  await s.upload(IMAGE_B);
  assert.equal(s.panelCache.get(IMAGE_KEY_A), null, "l'upload de B doit vider l'entrée");
});

test("La suppression invalide le cache via le VRAI handler de suppression", async () => {
  const s = scenario({ caches: 2 });
  await s.upload(IMAGE_A);
  await s.render(s.panelCache);
  await s.render(s.deliveryCache);
  assert.ok(s.panelCache.get(IMAGE_KEY_A), "précondition panneau");
  assert.ok(s.deliveryCache.get(IMAGE_KEY_A), "précondition livraison");

  await s.remove();

  assert.equal(s.panelCache.get(IMAGE_KEY_A), null, "le cache du panneau est vidé");
  assert.equal(s.deliveryCache.get(IMAGE_KEY_A), null, "le cache de livraison est vidé");
});

// ══════════════════════════════════════════════════════════════════════════
// C. Traçabilité — la preuve demandée dans les logs de production
// ══════════════════════════════════════════════════════════════════════════

test("Le rendu journalise la source, la taille et le SHA-256 du buffer servi", async () => {
  const s = scenario();
  await s.upload(IMAGE_A);

  // Première lecture : vient du stockage.
  await s.render(s.panelCache);
  const fromStorage = s.logger.logs.filter((log) => log.message === "Welcome image background resolved");
  assert.ok(fromStorage.length >= 1, "une trace de résolution doit être émise");
  const storage = fromStorage.at(-1);
  assert.equal(storage.source, "storage");
  assert.equal(storage.key, IMAGE_KEY_A);
  assert.equal(storage.bytes, IMAGE_A.length);
  assert.equal(storage.sha256, SHA_A, "le SHA-256 journalisé doit être celui de l'image réellement servie");

  // Seconde lecture : vient du cache.
  await s.render(s.panelCache);
  const cached = s.logger.logs.filter((log) => log.message === "Welcome image background resolved").at(-1);
  assert.equal(cached.source, "cache");
  assert.equal(cached.sha256, SHA_A);

  // Après remplacement, la trace doit montrer B.
  await s.upload(IMAGE_B);
  await s.render(s.panelCache);
  const afterReplace = s.logger.logs.filter((log) => log.message === "Welcome image background resolved").at(-1);
  assert.equal(afterReplace.sha256, SHA_B, "la trace doit refléter la nouvelle image");
  assert.equal(afterReplace.bytes, IMAGE_B.length);
});

test("L'invalidation est journalisée à l'upload et à la suppression", async () => {
  const s = scenario();
  await s.upload(IMAGE_A);
  assert.ok(s.logger.logs.some((log) => log.message === "Welcome image cache invalidated on upload"),
    "l'invalidation d'upload doit être traçable");

  await s.remove();
  const removal = s.logger.logs.find((log) => log.message === "Welcome image cache invalidated on removal");
  assert.ok(removal, "l'invalidation de suppression doit être traçable");
  assert.equal(removal.key, IMAGE_KEY_A);
});

// ══════════════════════════════════════════════════════════════════════════
// D. Sidecar — purgé à chaque upload, plus jamais lu au rendu
// ══════════════════════════════════════════════════════════════════════════

test("Aucun sidecar de géométrie ne survit à un upload (Phase 2.2)", async () => {
  const s = scenario();
  // Sidecar écrit à la main, comme l'aurait fait un upload de la Phase 2.1.
  s.bucket.objects.set(META_KEY_A, Buffer.from(JSON.stringify({
    version: 1, verdict: "CONFIRME", avatar: { cx: 1900, cy: 600, radius: 300 },
  }), "utf8"));

  await s.upload(IMAGE_B);   // un upload purge le sidecar, quel que soit son contenu

  assert.equal(s.bucket.objects.has(META_KEY_A), false,
    "le sidecar hérité doit être purgé à l'upload");
  assert.equal(sha256(s.bucket.objects.get(IMAGE_KEY_A)), SHA_B, "l'image active est B");
});

test("Aucune géométrie avatar n'atteint le rendu, ni pour A ni pour B (Phase 2.2)", async () => {
  const s = scenario();
  await s.upload(IMAGE_A);
  // Sidecar hérité de la Phase 2.1, posé à la main dans le bucket : le cas
  // « ancienne image personnalisée + ancien welcome.json » doit rester inerte.
  const geometryA = { cx: 100, cy: 100, radius: 50 };
  s.bucket.objects.set(META_KEY_A, Buffer.from(JSON.stringify({
    version: 1, verdict: "CONFIRME", avatar: geometryA,
  }), "utf8"));

  const before = await s.render(s.panelCache);
  assert.equal(before.sha256, SHA_A, "précondition : l'image servie est A");
  assert.equal(before.geometry, null, "une image personnalisée ne porte aucune zone avatar");

  await s.upload(IMAGE_B);
  const after = await s.render(s.panelCache);
  assert.equal(after.sha256, SHA_B, "l'image servie est B");
  assert.equal(after.geometry, null,
    "aucune géométrie — ni celle de A, ni aucune autre — ne doit atteindre le rendu");
});
