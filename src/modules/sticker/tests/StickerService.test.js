"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  StickerService,
  StickerErrorCode,
  STICKER_LIMIT_FREE,
  ACCEPTED_STICKER_CONTENT_TYPES,
  MAX_STICKER_BYTES,
} = require("../services/StickerService");
const { ActionRateLimitGuard, RATE_LIMITS } = require("../../../core/rateLimit/ActionRateLimitGuard");

function fakeTransport(overrides = {}) {
  const calls = { count: 0, create: 0 };
  const transport = {
    calls,
    countStickers: async () => { calls.count += 1; return overrides.count ?? 0; },
    createSticker: async ({ name }) => { calls.create += 1; return { id: "1", name }; },
    ...overrides,
  };
  return transport;
}

// ── Régression — comportement historique conservé ──────────────────────────

test("validate missing file and invalid name", () => {
  const svc = new StickerService();
  assert.equal(svc.validate({ file: null, name: "test" }).code, "STICKER_MISSING_FILE");
  assert.equal(svc.validate({ file: {}, name: "a" }).code, "STICKER_INVALID_NAME");
  assert.equal(svc.validate({ file: {}, name: "a".repeat(31) }).code, "STICKER_INVALID_NAME");
  assert.equal(svc.validate({ file: {}, name: "ab" }).ok, true);
});

test("upload respects Free limit 5", async () => {
  const svc = new StickerService({ limit: 5 });
  const transport = fakeTransport({ count: 5 });
  const res = await svc.upload({ file: {}, name: "test", transport });
  assert.equal(res.ok, false);
  assert.equal(res.code, "STICKER_LIMIT_REACHED");
  assert.equal(res.details.count, 5);
  assert.equal(res.details.limit, 5);
});

test("upload succeeds under limit", async () => {
  const svc = new StickerService({ limit: 5 });
  const transport = fakeTransport({ count: 4 });
  const res = await svc.upload({ file: {}, name: "  test  ", description: "desc", tags: "tag", transport });
  assert.equal(res.ok, true);
  assert.equal(res.code, "STICKER_UPLOADED");
  assert.equal(res.sticker.name, "test");
  assert.equal(res.details.count, 5);
});

test("upload handles fetch failure", async () => {
  const svc = new StickerService();
  const transport = {
    countStickers: async () => { throw new Error("fetch fail"); },
    createSticker: async () => ({}),
  };
  const res = await svc.upload({ file: {}, name: "test", transport });
  assert.equal(res.code, "STICKER_FETCH_FAILED");
});

test("upload handles create failure", async () => {
  const svc = new StickerService();
  const transport = {
    countStickers: async () => 0,
    createSticker: async () => { throw new Error("create fail"); },
  };
  const res = await svc.upload({ file: {}, name: "test", transport });
  assert.equal(res.code, "STICKER_UPLOAD_FAILED");
});

test("STICKER_LIMIT_FREE is 5", () => {
  assert.equal(STICKER_LIMIT_FREE, 5);
});

// ── P12 A — MIME acceptés ──────────────────────────────────────────────────

test("P12 A — accepted content types pass validation (png, apng, gif, json)", () => {
  const svc = new StickerService();
  assert.deepEqual([...ACCEPTED_STICKER_CONTENT_TYPES], ["image/png", "image/apng", "image/gif", "application/json"]);
  for (const contentType of ACCEPTED_STICKER_CONTENT_TYPES) {
    const res = svc.validate({ file: { contentType, size: 1000 }, name: "test" });
    assert.equal(res.ok, true, `${contentType} must be accepted`);
  }
  // Normalisation : casse + éventuel paramètre ignorés.
  assert.equal(svc.validate({ file: { contentType: "Image/PNG", size: 1000 }, name: "test" }).ok, true);
  assert.equal(svc.validate({ file: { contentType: "image/png; charset=binary", size: 1000 }, name: "test" }).ok, true);
});

// ── P12 B — MIME refusés ───────────────────────────────────────────────────

test("P12 B — rejected content types are refused locally", () => {
  const svc = new StickerService();
  assert.equal(svc.validate({ file: { contentType: "image/jpeg", size: 1000 }, name: "test" }).code, StickerErrorCode.UNSUPPORTED_FORMAT);
  assert.equal(svc.validate({ file: { contentType: "text/html", size: 1000 }, name: "test" }).code, StickerErrorCode.UNSUPPORTED_FORMAT);
  assert.equal(svc.validate({ file: { contentType: "application/x-msdownload", size: 1000 }, name: "test" }).code, StickerErrorCode.UNSUPPORTED_FORMAT);
  assert.equal(svc.validate({ file: { contentType: "image/webp", size: 1000 }, name: "test" }).code, StickerErrorCode.UNSUPPORTED_FORMAT);
});

// ── P12 C — tailles ────────────────────────────────────────────────────────

test("P12 C — size boundaries: under, exactly and over 512 KiB", () => {
  const svc = new StickerService();
  assert.equal(MAX_STICKER_BYTES, 512 * 1024);
  assert.equal(svc.validate({ file: { contentType: "image/png", size: MAX_STICKER_BYTES - 1 }, name: "test" }).ok, true, "just under");
  assert.equal(svc.validate({ file: { contentType: "image/png", size: MAX_STICKER_BYTES }, name: "test" }).ok, true, "exactly at the limit is accepted");
  assert.equal(
    svc.validate({ file: { contentType: "image/png", size: MAX_STICKER_BYTES + 1 }, name: "test" }).code,
    StickerErrorCode.TOO_LARGE,
    "just over the limit",
  );
});

test("P12 C — attachmentSizeLimit from the envelope is enforced", () => {
  const svc = new StickerService();
  assert.equal(svc.validate({ file: { contentType: "image/png", size: 1000 }, name: "test", attachmentSizeLimit: 500 }).code, StickerErrorCode.TOO_LARGE);
  assert.equal(svc.validate({ file: { contentType: "image/png", size: 1000 }, name: "test", attachmentSizeLimit: 2000 }).ok, true);
  assert.equal(svc.validate({ file: { contentType: "image/png", size: 1000 }, name: "test", attachmentSizeLimit: 1000 }).ok, true, "size == limit accepted");
  // Limite absente / invalide : ne casse pas, le 512 KiB fait foi.
  assert.equal(svc.validate({ file: { contentType: "image/png", size: 1000 }, name: "test", attachmentSizeLimit: null }).ok, true);
  assert.equal(svc.validate({ file: { contentType: "image/png", size: 1000 }, name: "test", attachmentSizeLimit: Number.NaN }).ok, true);
});

// ── P12 D — métadonnées absentes / invalides ───────────────────────────────

test("P12 D — absent MIME and absent size stay fail-open without crash", () => {
  const svc = new StickerService();
  assert.equal(svc.validate({ file: {}, name: "test" }).ok, true, "no contentType, no size");
  assert.equal(svc.validate({ file: { contentType: null, size: null }, name: "test" }).ok, true, "explicit nulls");
  assert.equal(svc.validate({ file: { contentType: 42, size: undefined }, name: "test" }).ok, true, "non-string contentType ignored");
  assert.equal(svc.validate({ file: { contentType: "", size: "" }, name: "test" }).code, StickerErrorCode.INVALID_SIZE, "empty string size is invalid");
});

test("P12 D — present but manifestly invalid sizes fail closed without crash", () => {
  const svc = new StickerService();
  assert.equal(svc.validate({ file: { contentType: "image/png", size: 0 }, name: "test" }).code, StickerErrorCode.INVALID_SIZE);
  assert.equal(svc.validate({ file: { contentType: "image/png", size: -1 }, name: "test" }).code, StickerErrorCode.INVALID_SIZE);
  assert.equal(svc.validate({ file: { contentType: "image/png", size: Number.NaN }, name: "test" }).code, StickerErrorCode.INVALID_SIZE);
  assert.equal(svc.validate({ file: { contentType: "image/png", size: "abc" }, name: "test" }).code, StickerErrorCode.INVALID_SIZE);
  assert.equal(svc.validate({ file: { contentType: "image/png", size: "1000" }, name: "test" }).ok, true, "numeric string accepted");
});

// ── P12 E — aucun transport appelé (donc aucun fetch) sur refus local ─────

test("P12 E — a local refusal never reaches countStickers/createSticker nor consumes a rate-limit credit", async () => {
  const svc = new StickerService();
  const guard = new ActionRateLimitGuard({ clock: () => 1_000_000 });

  for (const file of [
    { contentType: "image/jpeg", size: 1000 },
    { contentType: "image/png", size: MAX_STICKER_BYTES + 1 },
    { contentType: "image/png", size: 0 },
  ]) {
    const transport = fakeTransport();
    const res = await svc.upload({
      file,
      name: "test",
      transport,
      guildId: "g-local-refusal",
      userId: "u-local-refusal",
      rateLimitGuard: guard,
    });
    assert.equal(res.ok, false, "must be refused");
    assert.equal(transport.calls.count, 0, "countStickers must not be called");
    assert.equal(transport.calls.create, 0, "createSticker must not be called (no CDN fetch)");
  }
  assert.equal(guard.entries.size, 0, "no rate-limit credit may be consumed by a local refusal");
});

// ── P12 F — rate limit Sticker (Option D) ──────────────────────────────────

test("P12 F — 5 allowed, 6th refused with RATE_LIMITED", async () => {
  const svc = new StickerService();
  let now = 5_000_000;
  const guard = new ActionRateLimitGuard({ clock: () => now });
  const transport = fakeTransport();

  for (let i = 1; i <= RATE_LIMITS.STICKER.limit; i += 1) {
    const res = await svc.upload({ file: { contentType: "image/png", size: 1000 }, name: "test", transport, guildId: "g-rl", userId: "u-rl", rateLimitGuard: guard });
    assert.equal(res.ok, true, `${i} allowed`);
    assert.equal(transport.calls.create, i);
  }
  const refused = await svc.upload({ file: { contentType: "image/png", size: 1000 }, name: "test", transport, guildId: "g-rl", userId: "u-rl", rateLimitGuard: guard });
  assert.equal(refused.code, StickerErrorCode.RATE_LIMITED);
  assert.equal(transport.calls.create, RATE_LIMITS.STICKER.limit, "createSticker not called after the limit");
});

test("P12 F — isolation by guild and by user", async () => {
  const svc = new StickerService();
  const guard = new ActionRateLimitGuard({ clock: () => 6_000_000 });
  const transport = fakeTransport();

  for (let i = 0; i < RATE_LIMITS.STICKER.limit; i += 1) {
    await svc.upload({ file: { contentType: "image/png", size: 1000 }, name: "test", transport, guildId: "g-a", userId: "u-a", rateLimitGuard: guard });
  }
  const blocked = await svc.upload({ file: { contentType: "image/png", size: 1000 }, name: "test", transport, guildId: "g-a", userId: "u-a", rateLimitGuard: guard });
  assert.equal(blocked.code, StickerErrorCode.RATE_LIMITED);

  const otherGuild = await svc.upload({ file: { contentType: "image/png", size: 1000 }, name: "test", transport, guildId: "g-b", userId: "u-a", rateLimitGuard: guard });
  assert.equal(otherGuild.ok, true, "same user, other guild: allowed");
  const otherUser = await svc.upload({ file: { contentType: "image/png", size: 1000 }, name: "test", transport, guildId: "g-a", userId: "u-b", rateLimitGuard: guard });
  assert.equal(otherUser.ok, true, "same guild, other user: allowed");
});

test("P12 F — lazy expiration follows the P6 mechanism (windowMs Sticker)", async () => {
  const svc = new StickerService();
  let now = 7_000_000;
  const guard = new ActionRateLimitGuard({ clock: () => now });
  const transport = fakeTransport();

  for (let i = 0; i < RATE_LIMITS.STICKER.limit; i += 1) {
    await svc.upload({ file: { contentType: "image/png", size: 1000 }, name: "test", transport, guildId: "g-exp", userId: "u-exp", rateLimitGuard: guard });
  }
  const blocked = await svc.upload({ file: { contentType: "image/png", size: 1000 }, name: "test", transport, guildId: "g-exp", userId: "u-exp", rateLimitGuard: guard });
  assert.equal(blocked.code, StickerErrorCode.RATE_LIMITED);

  now += RATE_LIMITS.STICKER.windowMs; // la fenêtre entière s'écoule (expiration lazy à l'accès)
  const after = await svc.upload({ file: { contentType: "image/png", size: 1000 }, name: "test", transport, guildId: "g-exp", userId: "u-exp", rateLimitGuard: guard });
  assert.equal(after.ok, true, "allowed again after the window");
});

test("P12 F — STICKER group is wired and existing P6 limits are untouched", () => {
  assert.equal(RATE_LIMITS.STICKER.group, "sticker");
  assert.equal(RATE_LIMITS.STICKER.limit, 5);
  assert.equal(RATE_LIMITS.STICKER.windowMs, 10 * 60 * 1000);
  // Limites P6 existantes : inchangées.
  assert.equal(RATE_LIMITS.SUGGEST.limit, 3);
  assert.equal(RATE_LIMITS.SUGGEST.windowMs, 600000);
  assert.equal(RATE_LIMITS.TEMPVOICE.limit, 4);
  assert.equal(RATE_LIMITS.TEMPVOICE.windowMs, 60000);
  assert.equal(RATE_LIMITS.WELCOME_IMAGE.limit, 5);
  assert.equal(RATE_LIMITS.WELCOME_IMAGE.windowMs, 300000);
  assert.equal(RATE_LIMITS.CONFIG.limit, 30);
  assert.equal(RATE_LIMITS.CONFIG.windowMs, 60000);
  const groups = Object.values(RATE_LIMITS).map((value) => value.group);
  assert.equal(new Set(groups).size, groups.length, "groups stay unique");
});

// ── P12 G — interaction avec le count ──────────────────────────────────────

test("P12 G — under the limit with valid metadata: normal flow (count then create)", async () => {
  const svc = new StickerService({ limit: 5 });
  const guard = new ActionRateLimitGuard({ clock: () => 8_000_000 });
  const transport = fakeTransport({ count: 4 });
  const res = await svc.upload({ file: { contentType: "image/png", size: 1000 }, name: "test", transport, guildId: "g-g", userId: "u-g", rateLimitGuard: guard });
  assert.equal(res.ok, true);
  assert.equal(res.code, "STICKER_UPLOADED");
  assert.equal(transport.calls.count, 1);
  assert.equal(transport.calls.create, 1);
  assert.equal(guard.entries.size, 1, "credit consumed on the allowed path");
});

test("P12 G — at 5 stickers: LIMIT_REACHED after a valid local validation", async () => {
  const svc = new StickerService({ limit: 5 });
  const guard = new ActionRateLimitGuard({ clock: () => 9_000_000 });
  const transport = fakeTransport({ count: 5 });
  const res = await svc.upload({ file: { contentType: "image/gif", size: 1000 }, name: "test", transport, guildId: "g-g5", userId: "u-g5", rateLimitGuard: guard });
  assert.equal(res.code, "STICKER_LIMIT_REACHED");
  assert.equal(transport.calls.create, 0, "create never called");
});

test("P12 G — local validation failure: count is not called", async () => {
  const svc = new StickerService();
  const guard = new ActionRateLimitGuard({ clock: () => 9_100_000 });
  const transport = fakeTransport({ count: 0 });
  const res = await svc.upload({ file: { contentType: "image/jpeg", size: 1000 }, name: "test", transport, guildId: "g-gnj", userId: "u-gnj", rateLimitGuard: guard });
  assert.equal(res.code, StickerErrorCode.UNSUPPORTED_FORMAT);
  assert.equal(transport.calls.count, 0);
  assert.equal(guard.entries.size, 0);
});
