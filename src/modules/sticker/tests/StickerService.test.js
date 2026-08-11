"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { StickerService, STICKER_LIMIT_FREE } = require("../services/StickerService");

test("validate missing file and invalid name", () => {
  const svc = new StickerService();
  assert.equal(svc.validate({ file: null, name: "test" }).code, "STICKER_MISSING_FILE");
  assert.equal(svc.validate({ file: {}, name: "a" }).code, "STICKER_INVALID_NAME");
  assert.equal(svc.validate({ file: {}, name: "a".repeat(31) }).code, "STICKER_INVALID_NAME");
  assert.equal(svc.validate({ file: {}, name: "ab" }).ok, true);
});

test("upload respects Free limit 5", async () => {
  const svc = new StickerService({ limit: 5 });
  const transport = {
    countStickers: async () => 5,
    createSticker: async () => ({ id: "1", name: "test" }),
  };
  const res = await svc.upload({ file: {}, name: "test", transport });
  assert.equal(res.ok, false);
  assert.equal(res.code, "STICKER_LIMIT_REACHED");
  assert.equal(res.details.count, 5);
  assert.equal(res.details.limit, 5);
});

test("upload succeeds under limit", async () => {
  const svc = new StickerService({ limit: 5 });
  const transport = {
    countStickers: async () => 4,
    createSticker: async ({ name }) => ({ id: "1", name }),
  };
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
