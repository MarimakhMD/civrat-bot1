"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createCanvas, loadImage } = require("@napi-rs/canvas");
const { WelcomeTemplateRegistry } = require("../../rendering/WelcomeTemplateRegistry");
const { WelcomeImageRenderer } = require("../rendering/WelcomeImageRenderer");
const { WelcomeImageRequest } = require("../contracts/WelcomeImageRequest");
const { WelcomeImagePipeline } = require("../pipeline/WelcomeImagePipeline");

const registry = new WelcomeTemplateRegistry(); registry.discover();
const offlineRenderer = () => new WelcomeImageRenderer({ avatarLoader: async () => null });

function requestFor(overrides = {}) {
  return new WelcomeImageRequest({
    guildId: "g",
    userId: "u",
    locale: "fr",
    displayName: "Nina",
    textElements: [
      { id: "title", content: "Nina" },
      { id: "subtitle", content: "Bienvenue sur CIVRAT" },
    ],
    ...overrides,
  });
}

test("the three official templates are discovered with a renderable design", () => {
  const templates = registry.list();
  assert.equal(templates.length, 3);
  for (const id of ["template-1", "template-2", "template-3"]) {
    const template = registry.get(id);
    assert.ok(template, `${id} missing`);
    assert.ok(template.design, `${id} has no design`);
    assert.ok(template.assetsPath, `${id} has no assetsPath`);
  }
});

test("the three official templates ship their official background art at the declared dimensions", async () => {
  for (const id of ["template-1", "template-2", "template-3"]) {
    const template = registry.get(id);
    const { design } = template;
    assert.equal(typeof design.background.image, "string", `${id} must declare a background image asset`);
    const file = path.join(template.assetsPath, design.background.image);
    assert.ok(fs.existsSync(file), `${id} official artwork missing: ${file}`);
    // The canvas must match the artwork exactly: the renderer draws the image
    // 1:1, and any mismatch would distort the official design.
    const artwork = await loadImage(file);
    assert.equal(design.width, artwork.width, `${id} design width must equal artwork width`);
    assert.equal(design.height, artwork.height, `${id} design height must equal artwork height`);
    // The dynamic avatar disc must stay inside the baked circle of the artwork.
    assert.ok(design.avatar.cx - design.avatar.radius > 0, `${id} avatar overflows on the left`);
    assert.ok(design.avatar.cy - design.avatar.radius > 0, `${id} avatar overflows on the top`);
    assert.ok(design.avatar.cy + design.avatar.radius < design.height, `${id} avatar overflows on the bottom`);
  }
});

for (const id of ["template-1", "template-2", "template-3"]) {
  test(`template ${id} renders a valid PNG card`, async () => {
    const payload = await offlineRenderer().render(requestFor(), registry.get(id));
    assert.equal(payload.contentType, "image/png");
    assert.equal(payload.buffer.subarray(1, 4).toString(), "PNG");
    assert.equal(payload.width, registry.get(id).design.width);
    assert.equal(payload.height, registry.get(id).design.height);
  });
}

test("avatar present: the loader fetches the member avatar and it changes the card", async () => {
  const avatarCanvas = createCanvas(32, 32);
  const actx = avatarCanvas.getContext("2d");
  actx.fillStyle = "#ff0000";
  actx.fillRect(0, 0, 32, 32);
  const avatarBuffer = avatarCanvas.toBuffer("image/png");

  const requestedUrls = [];
  const renderer = new WelcomeImageRenderer({
    avatarLoader: async (url) => { requestedUrls.push(url); return avatarBuffer; },
  });
  const request = requestFor({ avatarUrl: "https://cdn.example/avatar.png" });
  const withAvatar = await renderer.render(request, registry.get("template-1"));
  assert.deepEqual(requestedUrls, ["https://cdn.example/avatar.png"]);

  const withoutAvatar = await new WelcomeImageRenderer({ avatarLoader: async () => null }).render(requestFor(), registry.get("template-1"));
  assert.ok(!withAvatar.buffer.equals(withoutAvatar.buffer), "avatar image must alter the rendered card");
});

test("avatar absent or unloadable: clean fallback, generation never fails", async () => {
  // No avatarUrl at all.
  const noUrl = await offlineRenderer().render(requestFor(), registry.get("template-2"));
  assert.equal(noUrl.buffer.subarray(1, 4).toString(), "PNG");
  // Loader receives a URL but fails (network/invalid payload).
  const failing = new WelcomeImageRenderer({ avatarLoader: async () => { throw new Error("network down"); } });
  const fallback = await failing.render(requestFor({ avatarUrl: "https://cdn.example/broken.png" }), registry.get("template-3"));
  assert.equal(fallback.buffer.subarray(1, 4).toString(), "PNG");
  // Loader returns a non-image payload.
  const garbage = new WelcomeImageRenderer({ avatarLoader: async () => Buffer.from("not-an-image") });
  const degraded = await garbage.render(requestFor({ avatarUrl: "https://cdn.example/garbage.png" }), registry.get("template-1"));
  assert.equal(degraded.buffer.subarray(1, 4).toString(), "PNG");
});

test("pipeline accepts an explicit template asset and stays stable across generations", async () => {
  const pipeline = new WelcomeImagePipeline({ renderer: offlineRenderer() });
  for (let index = 0; index < 5; index += 1) {
    const payload = await pipeline.generate(requestFor(), registry.get("template-2"));
    assert.ok(payload.buffer.length > 0);
  }
});
