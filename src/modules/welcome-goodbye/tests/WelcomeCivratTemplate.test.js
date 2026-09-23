"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createCanvas, loadImage } = require("@napi-rs/canvas");
const { WelcomeTemplateRegistry, defaultTemplateRoots, resolveBaseTemplate } = require("../rendering/WelcomeTemplateRegistry");
const { welcomeView } = require("../interactions/welcomeGoodbyeViews");
const { selectWelcomeTemplate } = require("../interactions/selectWelcomeTemplate");
const { WelcomeGoodbyeService } = require("../services/WelcomeGoodbyeService");
const { WelcomeGoodbyeConfigKey: Key, CIVRAT_GUILD_ID, CIVRAT_TEMPLATE_ID } = require("../configuration/welcomeGoodbyeConstants");
const { WelcomeImageRenderer } = require("../image/rendering/WelcomeImageRenderer");
const { buildWelcomeCardRequest } = require("../image/pipeline/buildWelcomeCardRequest");
const { ValidationError } = require("../../../core/errors");

const OTHER_GUILD = "999888777666555444";

function fullRegistry() {
  const registry = new WelcomeTemplateRegistry({ templatesPaths: defaultTemplateRoots() });
  registry.discover();
  return registry;
}

async function pixelsOf(buffer) {
  const image = await loadImage(buffer);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  return ctx.getImageData(0, 0, image.width, image.height);
}

function solidAvatar(hex) {
  const canvas = createCanvas(200, 200);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = hex;
  ctx.fillRect(0, 0, 200, 200);
  return canvas.toBuffer("image/png");
}

test("le registre par défaut ne découvre QUE les trois gabarits standards", () => {
  const registry = new WelcomeTemplateRegistry();
  const ids = registry.discover().map((t) => t.id);
  assert.deepEqual(ids, ["template-1", "template-2", "template-3"]);
  assert.equal(registry.get(CIVRAT_TEMPLATE_ID), null);
});

test("avec les racines par défaut de la composition, template-civrat est découvert", () => {
  const registry = fullRegistry();
  const ids = registry.list().map((t) => t.id);
  assert.ok(ids.includes("template-1") && ids.includes("template-2") && ids.includes("template-3"), "les 3 standards restent découverts");
  assert.ok(ids.includes(CIVRAT_TEMPLATE_ID), "template-civrat doit être découvert");
  const civrat = registry.get(CIVRAT_TEMPLATE_ID);
  // Canvas de rendu 1296×432 (ratio 3,00 identique à l'asset 2172×724).
  assert.equal(civrat.design.width, 1296);
  assert.equal(civrat.design.height, 432);
  assert.deepEqual(civrat.guildIds, [CIVRAT_GUILD_ID], "la restriction est portée par le manifeste");
  assert.ok(civrat.design.avatar, "template-civrat déclare une zone avatar fixe");
});

test("getForGuild : visible uniquement pour le guildId réservé", () => {
  const registry = fullRegistry();
  assert.equal(registry.getForGuild(CIVRAT_TEMPLATE_ID, CIVRAT_GUILD_ID)?.id, CIVRAT_TEMPLATE_ID);
  assert.equal(registry.getForGuild(CIVRAT_TEMPLATE_ID, OTHER_GUILD), null);
  // Les standards restent visibles partout.
  assert.equal(registry.getForGuild("template-2", OTHER_GUILD)?.id, "template-2");
  const forOther = registry.listForGuild(OTHER_GUILD).map((t) => t.id);
  assert.ok(!forOther.includes(CIVRAT_TEMPLATE_ID), "un autre serveur ne voit pas template-civrat");
  const forCivrat = registry.listForGuild(CIVRAT_GUILD_ID).map((t) => t.id);
  assert.ok(forCivrat.includes(CIVRAT_TEMPLATE_ID), "le serveur réservé voit template-civrat");
});

test("resolveBaseTemplate : un autre serveur retombé sur template-civrat revient à template-1", () => {
  const registry = fullRegistry();
  assert.equal(resolveBaseTemplate(registry, CIVRAT_TEMPLATE_ID, OTHER_GUILD)?.id, "template-1");
  assert.equal(resolveBaseTemplate(registry, CIVRAT_TEMPLATE_ID, CIVRAT_GUILD_ID)?.id, CIVRAT_TEMPLATE_ID);
  assert.equal(resolveBaseTemplate(registry, "template-3", OTHER_GUILD)?.id, "template-3");
});

test("vue Welcome : l'option CIVRAT n'apparaît que pour le guildId réservé", () => {
  const t = (key) => key;
  const generic = welcomeView({ t, config: {}, guildId: OTHER_GUILD });
  const genericOptions = generic.components.find((c) => c.customId === "civrat:v1:welcome-goodbye:template-select").options.map((o) => o.value);
  assert.deepEqual(genericOptions, ["template-1", "template-2", "template-3"], "serveur normal : 3 templates");

  const civrat = welcomeView({ t, config: {}, guildId: CIVRAT_GUILD_ID });
  const civratOptions = civrat.components.find((c) => c.customId === "civrat:v1:welcome-goodbye:template-select").options.map((o) => o.value);
  assert.deepEqual(civratOptions, ["template-1", "template-2", "template-3", CIVRAT_TEMPLATE_ID], "serveur CIVRAT : 4 templates");
});

test("sélection : un autre serveur ne peut pas forcer template-civrat", async () => {
  let config = { [Key.WELCOME_TEMPLATE]: "template-1" };
  const service = new WelcomeGoodbyeService({
    guildConfigResolver: { get: async () => config, update: async (_g, u) => { config = { ...config, ...u }; return config; } },
  });
  const context = {
    guildId: OTHER_GUILD,
    t: (k) => k,
    settings: service,
    envelope: { values: [CIVRAT_TEMPLATE_ID], transport: { update: async () => {} } },
  };
  await assert.rejects(() => selectWelcomeTemplate(context), ValidationError);
  assert.equal(config[Key.WELCOME_TEMPLATE], "template-1", "aucune écriture n'a eu lieu");
});

test("sélection : le serveur réservé peut choisir template-civrat", async () => {
  let config = { [Key.WELCOME_TEMPLATE]: "template-1" };
  const service = new WelcomeGoodbyeService({
    guildConfigResolver: { get: async () => config, update: async (_g, u) => { config = { ...config, ...u }; return config; } },
  });
  const context = {
    guildId: CIVRAT_GUILD_ID,
    t: (k) => k,
    settings: service,
    envelope: { values: [CIVRAT_TEMPLATE_ID], transport: { update: async () => {} } },
  };
  const result = await selectWelcomeTemplate(context);
  assert.equal(result[Key.WELCOME_TEMPLATE], CIVRAT_TEMPLATE_ID);
});

test("rendu CIVRAT : avatar dans le cercle + pseudo/nom, aucun subtitle", async () => {
  const registry = fullRegistry();
  const tpl = registry.getForGuild(CIVRAT_TEMPLATE_ID, CIVRAT_GUILD_ID);
  const avatar = solidAvatar("#ff00ff");
  const renderer = new WelcomeImageRenderer({ avatarLoader: async () => avatar });
  const member = { guildId: CIVRAT_GUILD_ID, userId: "u1", displayName: "Alice", username: "alice", avatarUrl: "test://a" };

  const withSub = buildWelcomeCardRequest({ member, subtitleText: "Welcome @mention to CIVRAT!", template: tpl });
  const noSub = buildWelcomeCardRequest({ member, subtitleText: "", template: tpl });
  const noTitle = buildWelcomeCardRequest({ member: { ...member, displayName: "", username: "" }, subtitleText: "Welcome", template: tpl });

  const a = await renderer.render(withSub, tpl);
  const b = await renderer.render(noSub, tpl);
  const c = await renderer.render(noTitle, tpl);

  // Le sous-titre n'a AUCUN effet sur l'image : buffers identiques.
  assert.deepEqual(a.buffer, b.buffer, "le message Welcome ne doit rien changer à l'image CIVRAT");
  // Le pseudo/nom, lui, est bien dessiné : retirer le titre change l'image.
  assert.notDeepEqual(a.buffer, c.buffer, "le pseudo/nom doit être dessiné");

  // L'avatar est dessiné au centre de la zone circulaire déclarée.
  const { cx, cy, radius } = tpl.design.avatar;
  const px = await pixelsOf(a.buffer);
  const at = (x, y) => {
    const i = (y * px.width + x) * 4;
    return [px.data[i], px.data[i + 1], px.data[i + 2]];
  };
  const center = at(cx, cy);
  assert.ok(center[0] > 200 && center[2] > 200, `le centre (${cx},${cy}) doit être l'avatar magenta, pas le fond vert`);
  const edge = at(cx + radius - 4, cy);
  assert.ok(edge[0] > 200 && edge[2] > 200, "l'avatar doit remplir le disque jusqu'au bord du cercle");
  assert.equal(a.width, tpl.design.width);
  assert.equal(a.height, tpl.design.height);
});
