"use strict";

/**
 * P6 §13 — rate-limit welcome image : 5 uploads / 5 min par (guild, user).
 *
 * Verrouille : 5 autorisés (le garde précède le fetch), 6e refusé AVANT
 * fetch / décodage / canvas / Storage / écritures de configuration,
 * isolations user et guild, expiration 5 minutes, message éphémère FR/EN.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { uploadWelcomeImage } = require("../interactions/welcomeImageUpload");
const { ActionRateLimitGuard, RATE_LIMITS } = require("../../../core/rateLimit/ActionRateLimitGuard");
const fr = require("../../../core/i18n/locales/fr.json");
const en = require("../../../core/i18n/locales/en.json");

const FR_MESSAGE = fr.ratelimit.retry;
const EN_MESSAGE = en.ratelimit.retry;

function harness() {
  let now = 1_000_000;
  const guard = new ActionRateLimitGuard({ clock: () => now });

  const counters = { fetch: 0, upload: 0, settingsUpdate: 0, decode: 0 };
  const replies = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    counters.fetch += 1;
    throw new Error("network disabled in tests");
  };

  function makeContext({ guildId = "g1", userId = "u1", locale = "fr" } = {}) {
    const t = (key) => (key === "ratelimit.retry" ? (locale === "fr" ? FR_MESSAGE : EN_MESSAGE) : key);
    return {
      guildId,
      userId,
      t,
      rateLimitGuard: guard,
      envelope: {
        transport: {
          async reply(payload) { replies.push({ guildId, userId, payload }); },
          async replyImagePreview() { throw new Error("replyImagePreview ne doit jamais être appelé ici"); },
        },
        options: {
          getAttachment: () => ({ url: "https://cdn.example/img.png", contentType: "image/png", size: 4096, name: "img.png" }),
        },
        attachmentSizeLimit: 25 * 1024 * 1024,
      },
      entitlementService: { requireFeature: async () => ({ ok: true, granted: true }) },
      imageStore: {
        available: true,
        async upload() { counters.upload += 1; return { key: "k" }; },
        async removeMeta() { return true; },
        keyFor: (guildId_) => `k/${guildId_}`,
      },
      settings: {
        async update() { counters.settingsUpdate += 1; return {}; },
      },
      logger: null,
    };
  }

  return {
    guard,
    tick: (ms) => { now += ms; },
    makeContext,
    counters,
    replies,
    restore: () => { globalThis.fetch = originalFetch; },
  };
}

test("P6 welcome image : 5 uploads autorisés, 6e refusé avant toute opération lourde", async () => {
  const h = harness();
  try {
    for (let i = 1; i <= 5; i += 1) {
      const result = await uploadWelcomeImage(h.makeContext());
      assert.notEqual(result.code, "WELCOME_IMAGE_RATE_LIMITED", `upload ${i}/5 autorisé par le garde`);
      assert.equal(h.counters.fetch, i, `le fetch EST atteint au crédit ${i} (garde avant lui)`);
    }
    assert.equal(h.counters.fetch, 5);

    const sixth = await uploadWelcomeImage(h.makeContext());
    assert.equal(sixth.ok, false);
    assert.equal(sixth.code, "WELCOME_IMAGE_RATE_LIMITED");
    assert.equal(h.counters.fetch, 5, "AUCUN fetch au refus");
    assert.equal(h.counters.upload, 0, "AUCUN upload Storage au refus");
    assert.equal(h.counters.settingsUpdate, 0, "AUCUNE écriture de métadonnées au refus");

    const refusal = h.replies[h.replies.length - 1];
    assert.equal(refusal.payload.ephemeral, true, "réponse éphémère");
    assert.equal(refusal.payload.view.content, FR_MESSAGE, "message FR non alarmiste");
  } finally {
    h.restore();
  }
});

test("P6 welcome image : isolation user et guild", async () => {
  const h = harness();
  try {
    for (let i = 0; i < 5; i += 1) await uploadWelcomeImage(h.makeContext({ guildId: "g1", userId: "u1" }));
    const exhausted = await uploadWelcomeImage(h.makeContext({ guildId: "g1", userId: "u1" }));
    assert.equal(exhausted.code, "WELCOME_IMAGE_RATE_LIMITED");

    const otherUser = await uploadWelcomeImage(h.makeContext({ guildId: "g1", userId: "u2" }));
    assert.notEqual(otherUser.code, "WELCOME_IMAGE_RATE_LIMITED", "user isolé");
    const otherGuild = await uploadWelcomeImage(h.makeContext({ guildId: "g2", userId: "u1" }));
    assert.notEqual(otherGuild.code, "WELCOME_IMAGE_RATE_LIMITED", "guild isolée");
  } finally {
    h.restore();
  }
});

test("P6 welcome image : expiration 5 minutes", async () => {
  const h = harness();
  try {
    for (let i = 0; i < 5; i += 1) await uploadWelcomeImage(h.makeContext());
    assert.equal((await uploadWelcomeImage(h.makeContext())).code, "WELCOME_IMAGE_RATE_LIMITED");

    h.tick(RATE_LIMITS.WELCOME_IMAGE.windowMs + 1);
    const after = await uploadWelcomeImage(h.makeContext());
    assert.notEqual(after.code, "WELCOME_IMAGE_RATE_LIMITED", "réarmé après 5 minutes");
    assert.equal(h.counters.fetch, 6, "fetch de nouveau atteint");
  } finally {
    h.restore();
  }
});

test("P6 welcome image : message EN en locale en", async () => {
  const h = harness();
  try {
    for (let i = 0; i < 5; i += 1) await uploadWelcomeImage(h.makeContext({ locale: "en" }));
    const refused = await uploadWelcomeImage(h.makeContext({ locale: "en" }));
    assert.equal(refused.code, "WELCOME_IMAGE_RATE_LIMITED");
    assert.equal(h.replies[h.replies.length - 1].payload.view.content, EN_MESSAGE);
    assert.notEqual(EN_MESSAGE, FR_MESSAGE);
  } finally {
    h.restore();
  }
});
