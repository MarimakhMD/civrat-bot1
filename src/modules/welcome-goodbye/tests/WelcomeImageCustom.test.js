"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createCanvas } = require("@napi-rs/canvas");

const {
  WELCOME_IMAGE_BUCKET,
  isDiscordGuildId,
  buildWelcomeImageObjectKey,
  isWelcomeImageObjectKey,
  guildIdOfWelcomeImageKey,
} = require("../configuration/welcomeImageStorage");
const { WelcomeImageStore } = require("../services/WelcomeImageStore");
const { resolveWelcomeImageTemplate } = require("../services/welcomeImageResource");
const { resolveWelcomeImageEntitlement } = require("../services/welcomeImageEntitlement");
const { WelcomeDeliveryService } = require("../services/WelcomeDeliveryService");
const { WelcomeTemplateRegistry } = require("../rendering/WelcomeTemplateRegistry");
const { WelcomeResourceCache } = require("../rendering/WelcomeResourceCache");
const { WelcomeImageRenderer } = require("../image/rendering/WelcomeImageRenderer");
const { WelcomeImagePipeline } = require("../image/pipeline/WelcomeImagePipeline");
const { buildWelcomeCardRequest } = require("../image/pipeline/buildWelcomeCardRequest");
const { EntitlementDecision, EntitlementFeature } = require("../../../core/entitlements");
const { uploadWelcomeImage } = require("../interactions/welcomeImageUpload");
const { removeWelcomeImage } = require("../interactions/welcomeImageActions");
const { welcomeImageView } = require("../interactions/welcomeImageView");
const { welcomeView } = require("../interactions/welcomeGoodbyeViews");
const {
  ACCEPTED_IMAGE_CONTENT_TYPES,
  checkWelcomeImageAttachment,
  WelcomeImageRejectReason,
} = require("../services/welcomeImageUploadValidation");
const { WelcomeGoodbyeConfigKey: Key } = require("../configuration/welcomeGoodbyeConstants");
const { WelcomeAdminAction } = require("../services/WelcomeAdminLogService");
const { toActionRows } = require("../../../adapters/discord/DiscordResponseTransport");

const GUILD_A = "111111111111111111";
const GUILD_B = "222222222222222222";
const KEY_A = `${GUILD_A}/welcome.png`;
const KEY_B = `${GUILD_B}/welcome.png`;

function png(width = 40, height = 20, color = "#112233") {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
  return canvas.toBuffer("image/png");
}

/** Bucket Supabase Storage factice, en mémoire, qui journalise les opérations. */
function createStorageFake(seed = {}) {
  const objects = new Map(Object.entries(seed));
  const calls = [];
  return {
    calls,
    objects,
    from(name) {
      return {
        async upload(objectName, buffer, options = {}) {
          calls.push({ op: "upload", bucket: name, objectName, options });
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

/** Même forme que EntitlementService.requireFeature : { ok, granted, code }. */
function createEntitlementFake({ granted = true, code = null, calls = [] } = {}) {
  return {
    calls,
    async requireFeature({ guildId, feature }) {
      calls.push({ guildId, feature });
      return {
        ok: granted,
        granted,
        code: code || (granted ? EntitlementDecision.GRANTED : EntitlementDecision.PREMIUM_REQUIRED),
      };
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
    async update(payload) {
      calls.push({ kind: "update", content: payload?.view?.content });
      return {};
    },
    async replyImagePreview(payload) {
      calls.push({ kind: "imagePreview", title: payload?.title, bytes: payload?.buffer?.length ?? null });
      return {};
    },
  };
}

function createAdminLogFake() {
  const calls = [];
  return { calls, record: (entry) => calls.push(entry) };
}

// ══════════════════════════════════════════════════════════════════════════
// A. Clé d'objet dérivée — isolation et anti-traversée
// ══════════════════════════════════════════════════════════════════════════

test("ImageWelcome — la clé d'objet est toujours dérivée du guildId", () => {
  assert.equal(buildWelcomeImageObjectKey(GUILD_A), KEY_A);
  assert.equal(isWelcomeImageObjectKey(KEY_A), true);
  assert.equal(guildIdOfWelcomeImageKey(KEY_A), GUILD_A);
});

test("ImageWelcome — les clés forgées ou traversantes sont refusées", () => {
  for (const forged of [
    "autre/welcome.png",
    "../etc/passwd",
    `${GUILD_A}/autre.png`,
    `${GUILD_A}/../../secret.png`,
    "42",
    `${KEY_A}/../x`,
  ]) {
    assert.equal(isWelcomeImageObjectKey(forged), false, `${forged} devrait être refusée`);
  }
  assert.equal(isDiscordGuildId("../etc"), false);
  assert.equal(isDiscordGuildId(GUILD_A), true);
});

// ══════════════════════════════════════════════════════════════════════════
// B. WelcomeImageStore — écriture, lecture, suppression
// ══════════════════════════════════════════════════════════════════════════

test("ImageWelcome — sans client de stockage le store est indisponible (fail-closed)", async () => {
  const store = new WelcomeImageStore();
  assert.equal(store.available, false);
  await assert.rejects(() => store.upload(GUILD_A, png(), { contentType: "image/png" }));
  assert.equal(await store.download(GUILD_A), null);
  assert.equal(await store.remove(GUILD_A), false);
});

test("ImageWelcome — l'upload est un upsert sur la clé de la guilde, avec son contentType", async () => {
  const storage = createStorageFake();
  const store = new WelcomeImageStore({ storage });
  await store.upload(GUILD_A, png(), { contentType: "image/webp" });
  await store.upload(GUILD_A, png(), { contentType: "image/webp" });

  const uploads = storage.calls.filter((call) => call.op === "upload");
  assert.equal(uploads.length, 2);
  for (const upload of uploads) {
    assert.equal(upload.objectName, KEY_A);
    assert.equal(upload.options.upsert, true, "le remplacement doit être un upsert");
    assert.equal(upload.options.contentType, "image/webp");
  }
  assert.equal(storage.objects.size, 1, "une seule image par guilde");
});

test("ImageWelcome — la suppression ne touche que la clé de la guilde concernée", async () => {
  const storage = createStorageFake({ [KEY_A]: png(), [KEY_B]: png() });
  const store = new WelcomeImageStore({ storage });

  assert.equal(await store.remove(GUILD_A), true);
  const removals = storage.calls.filter((call) => call.op === "remove");
  assert.deepEqual(removals.map((call) => call.objectNames), [[KEY_A]]);
  assert.equal(storage.objects.has(KEY_B), true, "l'image de la guilde B ne doit pas être affectée");
  assert.notEqual(await store.download(GUILD_B), null);
});

// ══════════════════════════════════════════════════════════════════════════
// C. resolveWelcomeImageTemplate — le gate central du rendu
// ══════════════════════════════════════════════════════════════════════════

function baseTemplate() {
  return Object.freeze({
    id: "template-1",
    design: Object.freeze({
      width: 200,
      height: 60,
      background: Object.freeze({ image: "background.png", colors: Object.freeze(["#000000", "#111111"]) }),
    }),
    assetsPath: path.join(__dirname, "..", "templates", "template-1"),
  });
}

test("ImageWelcome — sans image configurée, le template de base est rendu tel quel", async () => {
  const template = baseTemplate();
  const resolved = await resolveWelcomeImageTemplate({
    baseTemplate: template,
    config: { [Key.WELCOME_IMAGE_KEY]: null },
    guildId: GUILD_A,
    entitlement: { granted: true },
    imageStore: new WelcomeImageStore({ storage: createStorageFake() }),
  });
  assert.equal(resolved, template, "identité stricte : aucun objet dérivé inutile");
});

test("ImageWelcome — guilde Free : l'image stockée n'est JAMAIS injectée ni lue", async () => {
  const template = baseTemplate();
  const storage = createStorageFake({ [KEY_A]: png() });

  const resolved = await resolveWelcomeImageTemplate({
    baseTemplate: template,
    config: { [Key.WELCOME_IMAGE_KEY]: KEY_A },
    guildId: GUILD_A,
    entitlement: { granted: false, code: EntitlementDecision.PREMIUM_REQUIRED },
    imageStore: new WelcomeImageStore({ storage }),
  });

  assert.equal(resolved, template);
  assert.equal(storage.calls.filter((call) => call.op === "download").length, 0,
    "aucune lecture d'objet pour une guilde non Premium");
});

test("ImageWelcome — entitlement indisponible ou absent : fail-closed", async () => {
  const template = baseTemplate();
  for (const entitlement of [{ granted: false, code: EntitlementDecision.UNAVAILABLE }, undefined]) {
    const storage = createStorageFake({ [KEY_A]: png() });
    const resolved = await resolveWelcomeImageTemplate({
      baseTemplate: template,
      config: { [Key.WELCOME_IMAGE_KEY]: KEY_A },
      guildId: GUILD_A,
      entitlement,
      imageStore: new WelcomeImageStore({ storage }),
    });
    assert.equal(resolved, template);
    assert.equal(storage.calls.length, 0, "une décision manquante ne doit pas être interprétée comme un accord");
  }
});

test("ImageWelcome — Premium + image : template dérivé avec le buffer, registre intact", async () => {
  const template = baseTemplate();
  const image = png(60, 30);
  const storage = createStorageFake({ [KEY_A]: image });
  const resourceCache = new WelcomeResourceCache();
  const resolve = () => resolveWelcomeImageTemplate({
    baseTemplate: template,
    config: { [Key.WELCOME_IMAGE_KEY]: KEY_A },
    guildId: GUILD_A,
    entitlement: { granted: true },
    imageStore: new WelcomeImageStore({ storage }),
    resourceCache,
  });

  const resolved = await resolve();
  assert.notEqual(resolved, template, "un template dérivé est créé");
  assert.equal(resolved.design.background.buffer, image, "le buffer de la guilde est injecté");
  assert.equal(resolved.design.background.image, "background.png",
    "le fallback fichier est conservé en cas d'échec de décodage");
  assert.equal(resolved.assetsPath, template.assetsPath);

  // Le registre global n'est JAMAIS muté.
  assert.equal(template.design.background.buffer, undefined);
  assert.equal(Object.isFrozen(template), true);
  assert.equal(Object.isFrozen(resolved), true);

  // Deux résolutions partagent le même buffer (cache de ressources).
  assert.equal((await resolve()).design.background.buffer, image);
});

test("ImageWelcome — objet absent : retour au template de base, jamais d'exception", async () => {
  const template = baseTemplate();
  const resolved = await resolveWelcomeImageTemplate({
    baseTemplate: template,
    config: { [Key.WELCOME_IMAGE_KEY]: KEY_A },
    guildId: GUILD_A,
    entitlement: { granted: true },
    imageStore: new WelcomeImageStore({ storage: createStorageFake({}) }),
    logger: { error: () => {} },
  });
  assert.equal(resolved, template);
});

test("ImageWelcome — une clé d'une AUTRE guilde est ignorée", async () => {
  const template = baseTemplate();
  const storage = createStorageFake({ [KEY_B]: png() });
  const resolved = await resolveWelcomeImageTemplate({
    baseTemplate: template,
    config: { [Key.WELCOME_IMAGE_KEY]: KEY_B },
    guildId: GUILD_A,
    entitlement: { granted: true },
    imageStore: new WelcomeImageStore({ storage }),
    logger: { error: () => {} },
  });
  assert.equal(resolved, template, "aucune lecture inter-guildes");
  assert.equal(storage.calls.length, 0);
});

// ══════════════════════════════════════════════════════════════════════════
// D. Livraison — l'image personnalisée traverse le pipeline existant
// ══════════════════════════════════════════════════════════════════════════

/** Même construction que createGuildSettingsRuntime : discover() charge les templates du disque. */
function createTemplateRegistry() {
  const registry = new WelcomeTemplateRegistry();
  registry.discover();
  return registry;
}

function createDelivery({ entitlement, entitlementService = null, storage, pipeline, logger = null }) {
  const logs = [];
  const transport = {
    sent: [],
    async sendChannelMessage(channelId, payload) {
      this.sent.push({ channelId, payload });
      return { ok: true };
    },
  };
  const service = new WelcomeDeliveryService({
    renderer: { render: () => "Bienvenue Neo" },
    logService: {
      delivery: (event) => logs.push({ ...event, level: "info" }),
      failure: (event) => logs.push({ ...event, level: "warn" }),
    },
    imagePipeline: pipeline || { generate: async () => ({ buffer: png(120, 40) }) },
    templateRegistry: createTemplateRegistry(),
    entitlementService: entitlementService || createEntitlementFake(entitlement),
    imageStore: new WelcomeImageStore({ storage }),
    resourceCache: new WelcomeResourceCache(),
    logger,
  });
  return { service, transport, logs };
}

const MEMBER = {
  guildId: GUILD_A,
  userId: "424242424242424242",
  username: "neo",
  displayName: "Neo",
  avatarUrl: null,
  guild: { id: GUILD_A, name: "CIVRAT" },
  joinedAt: Date.now(),
};

function welcomeConfig(overrides = {}) {
  return {
    [Key.WELCOME_ENABLED]: true,
    [Key.WELCOME_CHANNEL]: "333333333333333333",
    [Key.WELCOME_MESSAGE]: "Bienvenue {user}",
    [Key.WELCOME_EMBED]: false,
    [Key.WELCOME_TEMPLATE]: "template-1",
    ...overrides,
  };
}

test("Livraison — toggle OFF : pas de carte, WELCOME_IMAGE_DISABLED, sans appel Premium", async () => {
  // Le fake est conservé pour prouver qu'il n'est JAMAIS consulté.
  const entitlement = createEntitlementFake({ granted: true });
  let generated = 0;
  const { service, transport, logs } = createDelivery({
    entitlementService: entitlement,
    storage: createStorageFake({ [KEY_A]: png() }),
    pipeline: { generate: async () => { generated += 1; return { buffer: png() }; } },
  });

  await service.welcome(MEMBER, welcomeConfig({
    [Key.WELCOME_IMAGE_ENABLED]: false,
    [Key.WELCOME_IMAGE_KEY]: KEY_A,
  }), transport);

  assert.equal(generated, 0, "aucun rendu demandé quand le toggle est OFF");
  assert.equal(transport.sent[0].payload.files, undefined, "aucune pièce jointe");
  const skipped = logs.find((log) => log.reason === "WELCOME_IMAGE_DISABLED");
  assert.ok(skipped, "motif WELCOME_IMAGE_DISABLED journalisé");
  assert.equal(entitlement.calls.length, 0, "le toggle est vérifié AVANT l'entitlement");
});

test("Livraison — toggle ON + guilde Free : PREMIUM_REQUIRED, aucun rendu", async () => {
  let generated = 0;
  const { service, transport, logs } = createDelivery({
    entitlement: { granted: false, code: EntitlementDecision.PREMIUM_REQUIRED },
    storage: createStorageFake({ [KEY_A]: png() }),
    pipeline: { generate: async () => { generated += 1; return { buffer: png() }; } },
  });

  await service.welcome(MEMBER, welcomeConfig({
    [Key.WELCOME_IMAGE_ENABLED]: true,
    [Key.WELCOME_IMAGE_KEY]: KEY_A,
  }), transport);

  assert.equal(generated, 0, "aucune carte pour une guilde Free");
  assert.equal(transport.sent[0].payload.files, undefined);
  assert.ok(logs.some((log) => log.reason === EntitlementDecision.PREMIUM_REQUIRED),
    "motif PREMIUM_REQUIRED journalisé");
});

test("Livraison — toggle ON + Premium + image : le buffer atteint le pipeline", async () => {
  const image = png(60, 30);
  const seen = [];
  const { service, transport } = createDelivery({
    entitlement: { granted: true },
    storage: createStorageFake({ [KEY_A]: image }),
    pipeline: { generate: async (request, template) => { seen.push({ request, template }); return { buffer: png() }; } },
  });

  await service.welcome(MEMBER, welcomeConfig({
    [Key.WELCOME_IMAGE_ENABLED]: true,
    [Key.WELCOME_IMAGE_KEY]: KEY_A,
  }), transport);

  assert.equal(seen.length, 1);
  assert.equal(seen[0].template.design.background.buffer, image,
    "l'image personnalisée traverse le pipeline de rendu existant");
  assert.equal(seen[0].request.guildId, GUILD_A);
  assert.equal(transport.sent[0].payload.files[0].name, "welcome-card.png");
});

test("Livraison — Premium mais objet absent : la carte standard est quand même produite", async () => {
  const seen = [];
  const { service, transport } = createDelivery({
    entitlement: { granted: true },
    storage: createStorageFake({}),
    pipeline: { generate: async (request, template) => { seen.push(template); return { buffer: png() }; } },
  });

  await service.welcome(MEMBER, welcomeConfig({
    [Key.WELCOME_IMAGE_ENABLED]: true,
    [Key.WELCOME_IMAGE_KEY]: KEY_A,
  }), transport);

  assert.equal(seen.length, 1, "la carte est tout de même produite");
  assert.equal(seen[0].design.background.buffer, undefined, "fond du template standard");
  assert.equal(transport.sent[0].payload.files[0].name, "welcome-card.png");
});

test("Livraison — Premium puis repasse Free : l'objet reste stocké mais n'est plus utilisé", async () => {
  const image = png(60, 30);
  const storage = createStorageFake({ [KEY_A]: image });
  const config = welcomeConfig({ [Key.WELCOME_IMAGE_ENABLED]: true, [Key.WELCOME_IMAGE_KEY]: KEY_A });

  const seenPremium = [];
  const premium = createDelivery({
    entitlement: { granted: true },
    storage,
    pipeline: { generate: async (request, template) => { seenPremium.push(template); return { buffer: png() }; } },
  });
  await premium.service.welcome(MEMBER, config, premium.transport);
  assert.equal(seenPremium[0].design.background.buffer, image, "Premium : image personnalisée");

  const seenFree = [];
  const free = createDelivery({
    entitlement: { granted: false, code: EntitlementDecision.PREMIUM_REQUIRED },
    storage,
    pipeline: { generate: async (request, template) => { seenFree.push(template); return { buffer: png() }; } },
  });
  await free.service.welcome(MEMBER, config, free.transport);

  assert.deepEqual(seenFree, [], "Free : aucune carte, l'image stockée n'est plus utilisée");
  assert.equal(free.transport.sent[0].payload.files, undefined);
  assert.equal(storage.objects.has(KEY_A), true,
    "l'objet reste en stockage (réactivable si la guilde redevient Premium)");
});

test("Rendu réel — carte PNG produite avec le fond personnalisé, et fallback si l'image est illisible", async () => {
  const template = createTemplateRegistry().get("template-1");
  assert.ok(template?.design, "template-1 doit être découvert depuis le disque");
  const renderer = new WelcomeImageRenderer({ resourceCache: new WelcomeResourceCache() });
  const pipeline = new WelcomeImagePipeline({ renderer });
  const request = buildWelcomeCardRequest({
    member: MEMBER,
    subtitleText: "Bienvenue Neo",
    template,
  });

  // 1. Image personnalisée valide → carte rendue.
  const valid = await resolveWelcomeImageTemplate({
    baseTemplate: template,
    config: { [Key.WELCOME_IMAGE_KEY]: KEY_A },
    guildId: GUILD_A,
    entitlement: { granted: true },
    imageStore: new WelcomeImageStore({ storage: createStorageFake({ [KEY_A]: png(60, 30, "#ff0000") }) }),
    resourceCache: new WelcomeResourceCache(),
  });
  const rendered = await pipeline.generate(request, valid);
  assert.ok(rendered.buffer.length > 1000, `carte PNG produite (${rendered.buffer.length} octets)`);
  assert.equal(rendered.buffer.subarray(0, 4).toString("hex"), "89504e47", "signature PNG");

  // 2. Image corrompue → le renderer retombe sur l'asset/dégradé : la carte est
  //    quand même produite (le Welcome n'est jamais bloqué par une image).
  const corrupt = await resolveWelcomeImageTemplate({
    baseTemplate: template,
    config: { [Key.WELCOME_IMAGE_KEY]: KEY_A },
    guildId: GUILD_A,
    entitlement: { granted: true },
    imageStore: new WelcomeImageStore({ storage: createStorageFake({ [KEY_A]: Buffer.from("pas une image") }) }),
    resourceCache: new WelcomeResourceCache(),
    logger: { error: () => {} },
  });
  assert.notEqual(corrupt.design.background.buffer, undefined, "le buffer corrompu est bien transmis");
  const fallback = await pipeline.generate(request, corrupt);
  assert.equal(fallback.buffer.subarray(0, 4).toString("hex"), "89504e47",
    "la carte est produite malgré l'image illisible");
});

// ══════════════════════════════════════════════════════════════════════════
// E. Commande /welcomeimage
// ══════════════════════════════════════════════════════════════════════════

function uploadContext({
  granted = true,
  code = null,
  storage,
  config,
  attachment,
  attachmentSizeLimit = 8 * 1024 * 1024,
}) {
  const settings = createSettingsFake({ [GUILD_A]: config || {} });
  const transport = createTransportFake();
  const adminLogService = createAdminLogFake();
  const generated = [];
  return {
    settings,
    transport,
    adminLogService,
    generated,
    t: (key) => key,
    guildId: GUILD_A,
    userId: "999999999999999999",
    entitlementService: createEntitlementFake({ granted, code }),
    imageStore: new WelcomeImageStore({ storage: storage || createStorageFake() }),
    resourceCache: new WelcomeResourceCache(),
    imagePipeline: { generate: async (request, template) => { generated.push({ request, template }); return { buffer: png(120, 40) }; } },
    templateRegistry: createTemplateRegistry(),
    envelope: {
      transport,
      attachmentSizeLimit,
      options: { getAttachment: () => attachment ?? null },
    },
  };
}

/** Remplace fetch le temps d'un test. */
async function withFetch(impl, run) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

const PNG_ATTACHMENT = { contentType: "image/png", size: 1024, url: "https://cdn/i.png" };

test("Upload — Premium + PNG valide : upsert, clé persistée, aperçu réel, log", async () => {
  const storage = createStorageFake();
  const context = uploadContext({ granted: true, storage, attachment: PNG_ATTACHMENT });

  const result = await withFetch(async () => ({ ok: true, arrayBuffer: async () => png(60, 30).buffer }),
    () => uploadWelcomeImage(context));

  assert.equal(result.code, "WELCOME_IMAGE_UPLOADED");
  assert.equal(result.key, KEY_A);
  assert.deepEqual(
    storage.calls.filter((call) => call.op === "upload").map((call) => call.objectName),
    [KEY_A],
  );
  assert.deepEqual(context.settings.updates, [
    { guildId: GUILD_A, patch: { [Key.WELCOME_IMAGE_KEY]: KEY_A } },
  ]);
  assert.equal(context.generated.length, 1, "un aperçu rendu avec la vraie carte");
  assert.equal(context.generated[0].template.design.background.buffer.length > 0, true);
  assert.ok(context.transport.calls.some((call) => call.kind === "imagePreview"));
  assert.deepEqual(context.adminLogService.calls.map((entry) => entry.action), [WelcomeAdminAction.IMAGE_UPLOADED]);
});

test("Upload — guilde Free : refusé, aucune écriture en stockage ni en base", async () => {
  const storage = createStorageFake();
  const context = uploadContext({
    granted: false,
    code: EntitlementDecision.PREMIUM_REQUIRED,
    storage,
    attachment: PNG_ATTACHMENT,
  });

  const result = await withFetch(async () => { throw new Error("fetch ne doit pas être appelé"); },
    () => uploadWelcomeImage(context));

  assert.equal(result.code, EntitlementDecision.PREMIUM_REQUIRED);
  assert.equal(result.granted, false);
  assert.deepEqual(context.settings.updates, []);
  assert.equal(storage.calls.length, 0);
  assert.deepEqual(context.adminLogService.calls, []);
});

test("Upload — backend d'entitlement indisponible : refusé (fail-closed)", async () => {
  const storage = createStorageFake();
  const context = uploadContext({
    granted: false,
    code: EntitlementDecision.UNAVAILABLE,
    storage,
    attachment: PNG_ATTACHMENT,
  });
  const result = await uploadWelcomeImage(context);
  assert.equal(result.code, EntitlementDecision.UNAVAILABLE);
  assert.deepEqual(context.settings.updates, []);
  assert.equal(storage.calls.length, 0);
});

test("Upload — service d'entitlement absent : refusé (fail-closed)", async () => {
  const context = uploadContext({ attachment: PNG_ATTACHMENT });
  context.entitlementService = null;
  const result = await uploadWelcomeImage(context);
  assert.equal(result.code, EntitlementDecision.UNAVAILABLE);
  assert.deepEqual(context.settings.updates, []);
});

test("Upload — stockage indisponible : aucune écriture en base", async () => {
  const context = uploadContext({ granted: true, attachment: PNG_ATTACHMENT });
  context.imageStore = new WelcomeImageStore(); // sans client de stockage
  const result = await uploadWelcomeImage(context);
  assert.equal(result.code, "WELCOME_IMAGE_STORAGE_UNAVAILABLE");
  assert.deepEqual(context.settings.updates, []);
});

test("Upload — l'upload n'active PAS le toggle Image Welcome", async () => {
  const storage = createStorageFake();
  const context = uploadContext({
    granted: true,
    storage,
    config: { [Key.WELCOME_IMAGE_ENABLED]: false },
    attachment: PNG_ATTACHMENT,
  });

  await withFetch(async () => ({ ok: true, arrayBuffer: async () => png(60, 30).buffer }),
    () => uploadWelcomeImage(context));

  assert.deepEqual(context.settings.updates.map((update) => update.patch), [{ [Key.WELCOME_IMAGE_KEY]: KEY_A }],
    "seule la clé est écrite : welcome_image_enabled n'est jamais touché");
});

test("Upload — le remplacement écrase l'image existante et ne garde qu'une clé", async () => {
  const storage = createStorageFake({ [KEY_A]: png(10, 10, "#000000") });
  const replacement = png(70, 35, "#00ff00");
  const context = uploadContext({
    granted: true,
    storage,
    config: { [Key.WELCOME_IMAGE_KEY]: KEY_A },
    attachment: { contentType: "image/jpeg", size: 2048, url: "https://cdn/i.jpg" },
  });

  const result = await withFetch(async () => ({ ok: true, arrayBuffer: async () => replacement.buffer }),
    () => uploadWelcomeImage(context));

  assert.equal(result.code, "WELCOME_IMAGE_UPLOADED");
  const uploads = storage.calls.filter((call) => call.op === "upload");
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].options.upsert, true);
  assert.equal(storage.objects.size, 1);
  assert.equal(storage.objects.get(KEY_A).equals(replacement), true, "le contenu a bien été remplacé");
});

test("Upload — formats acceptés et refusés", () => {
  for (const type of ["image/png", "image/jpeg", "image/webp", "image/avif", "image/gif"]) {
    const check = checkWelcomeImageAttachment({ attachment: { contentType: type, size: 1024 }, attachmentSizeLimit: 10 * 1024 * 1024 });
    assert.equal(check.ok, true, `${type} devrait être accepté`);
  }
  for (const type of ["application/pdf", "text/plain", "image/svg+xml", "application/octet-stream", null, undefined]) {
    const check = checkWelcomeImageAttachment({ attachment: { contentType: type, size: 1024 }, attachmentSizeLimit: 10 * 1024 * 1024 });
    assert.equal(check.ok, false, `${String(type)} devrait être refusé`);
    assert.equal(check.reason, WelcomeImageRejectReason.UNSUPPORTED_FORMAT);
  }
  assert.equal(ACCEPTED_IMAGE_CONTENT_TYPES.length, 5);
});

test("Upload — la limite de taille vient de l'interaction, jamais d'une constante", async () => {
  // Même fichier, deux limites d'API différentes : le résultat suit la limite.
  const attachment = { contentType: "image/png", size: 9 * 1024 * 1024 };
  assert.equal(checkWelcomeImageAttachment({ attachment, attachmentSizeLimit: 8 * 1024 * 1024 }).reason, WelcomeImageRejectReason.TOO_LARGE);
  assert.equal(checkWelcomeImageAttachment({ attachment, attachmentSizeLimit: 25 * 1024 * 1024 }).ok, true);

  const context = uploadContext({ granted: true, attachment, attachmentSizeLimit: 8 * 1024 * 1024 });
  const result = await uploadWelcomeImage(context);
  assert.equal(result.code, "WELCOME_IMAGE_REJECTED");
  assert.equal(result.reason, WelcomeImageRejectReason.TOO_LARGE);
  assert.deepEqual(context.settings.updates, []);
});

test("Upload — un fichier qui n'est pas une image est refusé après téléchargement", async () => {
  const storage = createStorageFake();
  const context = uploadContext({ granted: true, storage, attachment: { contentType: "image/png", size: 512, url: "https://cdn/i.png" } });

  const result = await withFetch(async () => ({ ok: true, arrayBuffer: async () => Buffer.from("ceci n'est pas une image").buffer }),
    () => uploadWelcomeImage(context));

  assert.equal(result.reason, WelcomeImageRejectReason.NOT_AN_IMAGE);
  assert.deepEqual(context.settings.updates, [], "rien n'est persisté pour un fichier invalide");
  assert.equal(storage.calls.filter((call) => call.op === "upload").length, 0);
});

test("Upload — pièce jointe absente et fichier vide", async () => {
  assert.equal(checkWelcomeImageAttachment({ attachment: null, attachmentSizeLimit: 1024 }).reason, WelcomeImageRejectReason.MISSING_ATTACHMENT);
  assert.equal(checkWelcomeImageAttachment({ attachment: { contentType: "image/png", size: 0 }, attachmentSizeLimit: 1024 }).reason, WelcomeImageRejectReason.EMPTY_FILE);

  const context = uploadContext({ granted: true, attachment: null });
  const result = await uploadWelcomeImage(context);
  assert.equal(result.code, "WELCOME_IMAGE_REJECTED");
  assert.equal(result.reason, WelcomeImageRejectReason.MISSING_ATTACHMENT);
});

// ══════════════════════════════════════════════════════════════════════════
// F. Suppression
// ══════════════════════════════════════════════════════════════════════════

function removeContext({ storage, config, guildId = GUILD_A }) {
  return {
    t: (key) => key,
    guildId,
    userId: "999999999999999999",
    settings: createSettingsFake({ [guildId]: config || {} }),
    imageStore: new WelcomeImageStore({ storage }),
    envelope: { transport: createTransportFake() },
  };
}

test("Suppression — la clé est remise à null ET l'objet est supprimé", async () => {
  const storage = createStorageFake({ [KEY_A]: png() });
  const context = removeContext({ storage, config: { [Key.WELCOME_IMAGE_KEY]: KEY_A } });

  const result = await removeWelcomeImage(context);

  assert.equal(result.removed, true);
  assert.deepEqual(context.settings.updates, [
    { guildId: GUILD_A, patch: { [Key.WELCOME_IMAGE_KEY]: null } },
  ]);
  assert.equal(storage.objects.has(KEY_A), false, "l'objet a bien été retiré du bucket");
  assert.deepEqual(
    storage.calls.filter((call) => call.op === "remove").map((call) => call.objectNames),
    [[KEY_A]],
  );
});

test("Suppression — guilde B : l'objet de la guilde A reste intact", async () => {
  const storage = createStorageFake({ [KEY_A]: png(), [KEY_B]: png() });
  const context = removeContext({ storage, config: { [Key.WELCOME_IMAGE_KEY]: KEY_B }, guildId: GUILD_B });

  await removeWelcomeImage(context);

  assert.equal(storage.objects.has(KEY_A), true);
  assert.equal(storage.objects.has(KEY_B), false);
});

test("Suppression — stockage indisponible : la clé est quand même remise à null", async () => {
  const context = removeContext({ storage: null, config: { [Key.WELCOME_IMAGE_KEY]: KEY_A } });
  context.imageStore = new WelcomeImageStore();

  const result = await removeWelcomeImage(context);

  assert.equal(result.removed, false);
  assert.deepEqual(context.settings.updates, [
    { guildId: GUILD_A, patch: { [Key.WELCOME_IMAGE_KEY]: null } },
  ], "aucune clé fantôme ne doit subsister");
});

// ══════════════════════════════════════════════════════════════════════════
// G. Sous-vue : états et i18n
// ══════════════════════════════════════════════════════════════════════════

const FR = {
  "errors.premiumRequiredTitle": "Fonctionnalité Premium",
  "errors.premiumRequired": "Fonctionnalité Premium requise.",
  "errors.entitlementUnavailable": "Vérification Premium indisponible.",
  "welcomeGoodbye.welcomeImageTitle": "🖼️ Image Welcome",
  "welcomeGoodbye.welcomeImageNone": "Aucune image personnalisée : le template sélectionné est utilisé.",
  "welcomeGoodbye.welcomeImageActive": "Image personnalisée active : elle remplace le fond du template.",
  "welcomeGoodbye.welcomeImageToggleOffWarning": "⚠️ L’image Welcome est désactivée : activez-la pour qu’elle soit utilisée.",
  "welcomeGoodbye.welcomeImageChoose": "Choisir une image",
  "welcomeGoodbye.welcomeImageReplace": "Remplacer",
  "welcomeGoodbye.welcomeImageRemove": "Supprimer",
  "welcomeGoodbye.welcomeImagePreview": "Aperçu",
  "welcomeGoodbye.welcomeImageMenu": "Image Welcome",
  "welcomeGoodbye.back": "Retour",
};
const EN = {
  "errors.premiumRequiredTitle": "Premium feature",
  "errors.premiumRequired": "Premium feature required.",
  "errors.entitlementUnavailable": "Premium verification unavailable.",
  "welcomeGoodbye.welcomeImageTitle": "🖼️ Welcome Image",
  "welcomeGoodbye.welcomeImageNone": "No custom image: the selected template is used.",
  "welcomeGoodbye.welcomeImageActive": "Custom image active: it replaces the template background.",
  "welcomeGoodbye.welcomeImageToggleOffWarning": "⚠️ The Welcome image is disabled: enable it for the image to be used.",
  "welcomeGoodbye.welcomeImageChoose": "Choose an image",
  "welcomeGoodbye.welcomeImageReplace": "Replace",
  "welcomeGoodbye.welcomeImageRemove": "Delete",
  "welcomeGoodbye.welcomeImagePreview": "Preview",
  "welcomeGoodbye.welcomeImageMenu": "Welcome Image",
  "welcomeGoodbye.back": "Back",
};

function translate(map) {
  return (key, variables = {}) => {
    assert.ok(key in map, `clé non traduite : ${key}`);
    let text = map[key];
    for (const [name, value] of Object.entries(variables)) text = text.split(`{{${name}}}`).join(String(value));
    return text;
  };
}

const labelsOf = (view) => view.components.flat().map((component) => component.label);

test("Sous-vue — Free : « Premium requis », aucun bouton d'image", () => {
  const view = welcomeImageView({
    t: translate(FR),
    guildId: GUILD_A,
    config: { [Key.WELCOME_IMAGE_ENABLED]: true, [Key.WELCOME_IMAGE_KEY]: KEY_A },
    entitlement: { granted: false, code: EntitlementDecision.PREMIUM_REQUIRED },
  });
  assert.equal(view.content, FR["errors.premiumRequired"]);
  assert.deepEqual(labelsOf(view), [FR["welcomeGoodbye.back"]]);
});

test("Sous-vue — entitlement indisponible : fail-closed, aucun bouton d'image", () => {
  const view = welcomeImageView({
    t: translate(FR),
    guildId: GUILD_A,
    config: { [Key.WELCOME_IMAGE_ENABLED]: true, [Key.WELCOME_IMAGE_KEY]: KEY_A },
    entitlement: { granted: false, code: EntitlementDecision.UNAVAILABLE },
  });
  assert.equal(view.content, FR["errors.entitlementUnavailable"]);
  assert.deepEqual(labelsOf(view), [FR["welcomeGoodbye.back"]]);
});

test("Sous-vue — Premium sans image : « Choisir une image », pas de suppression ni d'aperçu", () => {
  const view = welcomeImageView({
    t: translate(FR),
    guildId: GUILD_A,
    config: { [Key.WELCOME_IMAGE_ENABLED]: true, [Key.WELCOME_IMAGE_KEY]: null },
    entitlement: { granted: true },
  });
  assert.deepEqual(labelsOf(view), [FR["welcomeGoodbye.welcomeImageChoose"], FR["welcomeGoodbye.back"]]);
  assert.ok(view.content.includes(FR["welcomeGoodbye.welcomeImageNone"]));
  assert.ok(!view.content.includes(FR["welcomeGoodbye.welcomeImageToggleOffWarning"]));
});

test("Sous-vue — Premium avec image : aperçu + remplacer + supprimer + retour", () => {
  const view = welcomeImageView({
    t: translate(FR),
    guildId: GUILD_A,
    config: { [Key.WELCOME_IMAGE_ENABLED]: true, [Key.WELCOME_IMAGE_KEY]: KEY_A },
    entitlement: { granted: true },
  });
  assert.deepEqual(labelsOf(view), [
    FR["welcomeGoodbye.welcomeImagePreview"],
    FR["welcomeGoodbye.welcomeImageReplace"],
    FR["welcomeGoodbye.welcomeImageRemove"],
    FR["welcomeGoodbye.back"],
  ]);
  assert.ok(view.content.includes(FR["welcomeGoodbye.welcomeImageActive"]));
});

test("Sous-vue — toggle OFF : avertissement explicite ajouté", () => {
  const view = welcomeImageView({
    t: translate(FR),
    guildId: GUILD_A,
    config: { [Key.WELCOME_IMAGE_ENABLED]: false, [Key.WELCOME_IMAGE_KEY]: KEY_A },
    entitlement: { granted: true },
  });
  assert.ok(view.content.includes(FR["welcomeGoodbye.welcomeImageToggleOffWarning"]));
});

test("Sous-vue — FR et EN sont intégralement traduits, sans texte codé en dur", () => {
  const states = [
    { config: { [Key.WELCOME_IMAGE_ENABLED]: true }, entitlement: { granted: false, code: EntitlementDecision.PREMIUM_REQUIRED } },
    { config: { [Key.WELCOME_IMAGE_ENABLED]: true, [Key.WELCOME_IMAGE_KEY]: null }, entitlement: { granted: true } },
    { config: { [Key.WELCOME_IMAGE_ENABLED]: false, [Key.WELCOME_IMAGE_KEY]: KEY_A }, entitlement: { granted: true } },
  ];

  for (const state of states) {
    const fr = welcomeImageView({ t: translate(FR), guildId: GUILD_A, ...state });
    const en = welcomeImageView({ t: translate(EN), guildId: GUILD_A, ...state });

    assert.notEqual(fr.content, en.content, "les contenus FR et EN doivent différer");
    assert.equal(fr.components.flat().length, en.components.flat().length, "même nombre de boutons");

    for (const component of fr.components.flat()) {
      assert.ok(Object.values(FR).includes(component.label), `libellé FR non traduit : ${component.label}`);
    }
    for (const component of en.components.flat()) {
      assert.ok(Object.values(EN).includes(component.label), `libellé EN non traduit : ${component.label}`);
    }
    // Aucun libellé FR ne doit se retrouver dans la vue EN, et inversement.
    const shared = fr.components.flat().map((c) => c.label).filter((label) => labelsOf(en).includes(label));
    assert.deepEqual(shared.filter((label) => label !== FR["welcomeGoodbye.back"]), []);
  }
});

// ══════════════════════════════════════════════════════════════════════════
// H. Limite Discord : 5 lignes d'Action Row maximum
// ══════════════════════════════════════════════════════════════════════════

test("Limite Discord — la vue Welcome principale reste à 5 lignes avec le nouveau bouton", () => {
  // La mise en pages ne dépend pas de la langue : on utilise un t neutre pour
  // n'assertionner que la structure (Discord refuse au-delà de 5 Action Rows).
  const id = (key) => key;
  const view = welcomeView({ t: id, config: { [Key.WELCOME_IMAGE_ENABLED]: false } });
  const components = view.components.flat();
  const rows = toActionRows(view.components);

  assert.equal(rows.length, 5, `5 lignes maximum, obtenu ${rows.length}`);
  assert.ok(components.length <= 25, `${components.length} composants tiennent dans 5 lignes de 5`);
  assert.ok(labelsOf(view).includes("welcomeGoodbye.welcomeImageMenu"),
    "le bouton « Image Welcome » est présent dans la vue principale");

  // Sans le nouveau bouton, la vue tenait déjà dans 5 lignes : le bouton a été
  // placé dans la dernière ligne existante, sans créer de sixième ligne.
  const withoutNewButton = welcomeView({ t: id, config: { [Key.WELCOME_IMAGE_ENABLED]: false } });
  assert.equal(toActionRows(withoutNewButton.components).length, 5);
});

test("Limite Discord — la sous-vue Image Welcome tient sur une seule ligne", () => {
  const view = welcomeImageView({
    t: translate(FR),
    guildId: GUILD_A,
    config: { [Key.WELCOME_IMAGE_ENABLED]: true, [Key.WELCOME_IMAGE_KEY]: KEY_A },
    entitlement: { granted: true },
  });
  assert.equal(toActionRows(view.components).length, 1);
  assert.ok(view.components.flat().length <= 5, "5 boutons maximum sur la ligne");
});

// ══════════════════════════════════════════════════════════════════════════
// I. Résolution d'entitlement dédiée
// ══════════════════════════════════════════════════════════════════════════

test("Entitlement — feature WELCOME_IMAGE, granted propagé, erreurs normalisées en UNAVAILABLE", async () => {
  const granted = createEntitlementFake({ granted: true });
  const decision = await resolveWelcomeImageEntitlement({ guildId: GUILD_A, entitlementService: granted });
  assert.equal(decision.granted, true);
  assert.equal(decision.code, EntitlementDecision.GRANTED);
  assert.equal(granted.calls[0].feature, EntitlementFeature.WELCOME_IMAGE);

  const failing = { requireFeature: async () => { throw new Error("backend HS"); } };
  const unavailable = await resolveWelcomeImageEntitlement({ guildId: GUILD_A, entitlementService: failing });
  assert.equal(unavailable.granted, false);
  assert.equal(unavailable.code, EntitlementDecision.UNAVAILABLE);

  const missing = await resolveWelcomeImageEntitlement({ guildId: GUILD_A });
  assert.equal(missing.granted, false);
  assert.equal(missing.code, EntitlementDecision.UNAVAILABLE);
});
