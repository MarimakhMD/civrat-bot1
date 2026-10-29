"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { InteractionRegistry } = require("../../../core/interactions");
const { PermissionName } = require("../../../core/permissions");
const { registerSticker } = require("../register");
const { MAX_STICKER_BYTES } = require("../services/StickerService");
const { ActionRateLimitGuard, RATE_LIMITS } = require("../../../core/rateLimit/ActionRateLimitGuard");

test("uploadsticker registers ManageGuild command with file option", () => {
  const registry = new InteractionRegistry();
  const result = registerSticker({ registry });
  assert.equal(result.commands.length, 1);
  assert.equal(result.commands[0].name, "uploadsticker");
  assert.deepEqual(result.commands[0].permissions.allOf, [PermissionName.MANAGE_GUILD]);
  const route = registry.find({ kind: "command", name: "uploadsticker" });
  assert.ok(route);
  assert.ok(route.options.some((o) => o.name === "file" && o.type === "attachment"));
  assert.ok(route.options.some((o) => o.name === "name" && o.type === "string"));
});

test("uploadsticker command respects limit via service", async () => {
  const registry = new InteractionRegistry();
  registerSticker({ registry });
  const route = registry.find({ kind: "command", name: "uploadsticker" });
  // Mock transport that returns count 5 (limit reached)
  let replied = null;
  const context = {
    t: (k, vars) => `${k} ${JSON.stringify(vars || {})}`,
    envelope: {
      options: {
        getString: (name) => (name === "name" ? "test" : null),
        getAttachment: (name) => (name === "file" ? { url: "http://example.com/sticker.png" } : null),
      },
      discordMember: { guild: { stickers: { fetch: async () => new Map([["1", {}], ["2", {}], ["3", {}], ["4", {}], ["5", {}]]) } } },
      transport: { reply: async (payload) => { replied = payload; } },
    },
  };
  // Force service to see 5 stickers via transport mock inside register (uses real DiscordStickerTransport which will fetch 5)
  // Here we test the service directly for limit, as the command's transport will use real guild which we mock to 5
  // Instead test service directly
  const { StickerService } = require("../services/StickerService");
  const svc = new StickerService({ limit: 5 });
  const res = await svc.upload({ file: {}, name: "test", transport: { countStickers: async () => 5, createSticker: async () => ({}) } });
  assert.equal(res.code, "STICKER_LIMIT_REACHED");
});

test("P12 — the file option description no longer promises JPEG", () => {
  const registry = new InteractionRegistry();
  const { commands } = registerSticker({ registry });
  const fileOption = commands[0].options.find((o) => o.name === "file");
  assert.ok(fileOption);
  assert.ok(!/jpeg/i.test(fileOption.description), "description must not advertise jpeg");
  assert.match(fileOption.description, /png/i);
  assert.match(fileOption.description, /lottie/i);
});

// ── P12 e2e — vrai flux commande → service → validation → rate limit → transport ──

function commandHarness({ attachment, stickersCount = 0, guildId = "g-e2e", userId = "u-e2e", attachmentSizeLimit = null, rateLimitGuard = null }) {
  const calls = { fetch: 0, create: 0 };
  const replies = [];
  const guild = {
    stickers: {
      fetch: async () => {
        calls.fetch += 1;
        const map = new Map();
        for (let i = 0; i < stickersCount; i += 1) map.set(String(i), { id: String(i) });
        return map;
      },
      create: async (opts) => {
        calls.create += 1;
        return { id: "new-sticker", name: opts.name };
      },
    },
  };
  const context = {
    guildId,
    userId,
    rateLimitGuard,
    t: (key, vars) => (vars && Object.keys(vars).length ? `${key} ${JSON.stringify(vars)}` : key),
    envelope: {
      attachmentSizeLimit,
      options: {
        getString: (optionName) => (optionName === "name" ? "test" : null),
        getAttachment: (optionName) => (optionName === "file" ? attachment : null),
      },
      discordMember: { guild },
      transport: { reply: async (payload) => { replies.push(payload); } },
    },
  };
  return { context, calls, replies };
}

async function run(harness) {
  const registry = new InteractionRegistry();
  registerSticker({ registry });
  const route = registry.find({ kind: "command", name: "uploadsticker" });
  const result = await route.execute(harness.context);
  return { result, replyTitle: harness.replies[0]?.view?.title };
}

test("P12 e2e — a rejected MIME answers the dedicated message without touching the transport", async () => {
  const guard = new ActionRateLimitGuard({ clock: () => 1_000_000 });
  const harness = commandHarness({
    attachment: { contentType: "image/jpeg", size: 1000, url: "https://cdn.discordapp.com/x.png" },
    rateLimitGuard: guard,
  });
  const { result, replyTitle } = await run(harness);
  assert.equal(result.ok, false);
  assert.equal(result.code, "STICKER_UNSUPPORTED_FORMAT");
  assert.match(replyTitle, /sticker\.unsupportedFormat/);
  assert.equal(harness.calls.fetch, 0, "countStickers must not be called");
  assert.equal(harness.calls.create, 0, "createSticker must not be called (no CDN fetch)");
  assert.equal(guard.entries.size, 0, "no rate-limit credit consumed");
});

test("P12 e2e — a file over 512 KiB is refused before any transport call", async () => {
  const guard = new ActionRateLimitGuard({ clock: () => 2_000_000 });
  const harness = commandHarness({
    attachment: { contentType: "image/png", size: MAX_STICKER_BYTES + 1, url: "https://cdn.discordapp.com/x.png" },
    rateLimitGuard: guard,
  });
  const { result, replyTitle } = await run(harness);
  assert.equal(result.code, "STICKER_TOO_LARGE");
  assert.match(replyTitle, /sticker\.tooLarge/);
  assert.equal(harness.calls.fetch, 0);
  assert.equal(harness.calls.create, 0);
  assert.equal(guard.entries.size, 0);
});

test("P12 e2e — the envelope attachmentSizeLimit is transmitted and enforced", async () => {
  const guard = new ActionRateLimitGuard({ clock: () => 3_000_000 });
  const harness = commandHarness({
    attachment: { contentType: "image/png", size: 1000, url: "https://cdn.discordapp.com/x.png" },
    attachmentSizeLimit: 500,
    rateLimitGuard: guard,
  });
  const { result, replyTitle } = await run(harness);
  assert.equal(result.code, "STICKER_TOO_LARGE");
  assert.match(replyTitle, /sticker\.tooLarge/);
  assert.equal(harness.calls.create, 0);
});

test("P12 e2e — a valid upload flows through count and create, consuming one credit", async () => {
  const guard = new ActionRateLimitGuard({ clock: () => 4_000_000 });
  const harness = commandHarness({
    attachment: { contentType: "image/png", size: 1000, url: "https://cdn.discordapp.com/x.png" },
    rateLimitGuard: guard,
  });
  const { result, replyTitle } = await run(harness);
  assert.equal(result.ok, true);
  assert.equal(result.code, "STICKER_UPLOADED");
  assert.match(replyTitle, /sticker\.uploadSuccess/);
  assert.equal(harness.calls.fetch, 1);
  assert.equal(harness.calls.create, 1);
  assert.equal(guard.entries.size, 1, "exactly one credit consumed on the allowed path");
});

test("P12 e2e — once the rate limit is exhausted the request is refused before count/create", async () => {
  const guard = new ActionRateLimitGuard({ clock: () => 5_000_000 });
  for (let i = 0; i < RATE_LIMITS.STICKER.limit; i += 1) {
    guard.record({ guildId: "g-e2e", userId: "u-e2e", ...RATE_LIMITS.STICKER });
  }
  const harness = commandHarness({
    attachment: { contentType: "image/png", size: 1000, url: "https://cdn.discordapp.com/x.png" },
    rateLimitGuard: guard,
  });
  const { result, replyTitle } = await run(harness);
  assert.equal(result.code, "STICKER_RATE_LIMITED");
  assert.match(replyTitle, /ratelimit\.retry/);
  assert.equal(harness.calls.fetch, 0, "count not called when rate-limited");
  assert.equal(harness.calls.create, 0, "create not called when rate-limited");
});

test("P12 e2e — at 5 stickers the route answers LIMIT_REACHED after local validation", async () => {
  const guard = new ActionRateLimitGuard({ clock: () => 6_000_000 });
  const harness = commandHarness({
    attachment: { contentType: "image/gif", size: 1000, url: "https://cdn.discordapp.com/x.png" },
    stickersCount: 5,
    rateLimitGuard: guard,
  });
  const { result, replyTitle } = await run(harness);
  assert.equal(result.code, "STICKER_LIMIT_REACHED");
  assert.match(replyTitle, /sticker\.limitReached/);
  assert.equal(harness.calls.create, 0, "create never called at the limit");
});
