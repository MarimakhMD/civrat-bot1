"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { WelcomeDeliveryService } = require("../services/WelcomeDeliveryService");
const { WelcomeTemplateRenderer, defaultPlaceholderProviders } = require("../services/WelcomeTemplateRenderer");
const { WelcomeTemplateRegistry } = require("../rendering/WelcomeTemplateRegistry");
const { WelcomeImageRenderer } = require("../image/rendering/WelcomeImageRenderer");
const { WelcomeImagePipeline } = require("../image/pipeline/WelcomeImagePipeline");

const member = {
  guildId: "guild",
  userId: "user-1",
  user: "@nina",
  mention: "@nina",
  username: "nina",
  displayName: "Nina",
  avatarUrl: "https://cdn.example/nina.png",
  server: "CIVRAT",
  memberCount: 42,
  joinDate: "11/08/2026",
};

function createDelivery({ failPipeline = false } = {}) {
  const registry = new WelcomeTemplateRegistry(); registry.discover();
  const renderer = new WelcomeImageRenderer({ avatarLoader: async () => null });
  const pipeline = failPipeline
    ? { generate: async () => { throw new Error("render exploded"); } }
    : new WelcomeImagePipeline({ renderer });
  return new WelcomeDeliveryService({
    renderer: new WelcomeTemplateRenderer({ providers: defaultPlaceholderProviders() }),
    imagePipeline: pipeline,
    templateRegistry: registry,
  });
}

function welcomeConfig(overrides = {}) {
  return {
    welcome_enabled: true,
    welcome_channel_id: "channel-1",
    welcome_message: "Bienvenue {mention} sur {server} ! ({membercount} membres)",
    welcome_embed_enabled: false,
    ...overrides,
  };
}

test("welcome delivery attaches a generated card using the selected template", async () => {
  const sent = [];
  const delivery = createDelivery();
  await delivery.welcome(member, welcomeConfig({ welcome_template_id: "template-2" }), {
    sendChannelMessage: async (...args) => sent.push(args),
  });
  assert.equal(sent.length, 1);
  const [channelId, payload] = sent[0];
  assert.equal(channelId, "channel-1");
  // Placeholders still resolve in the text content.
  assert.equal(payload.content, "Bienvenue @nina sur CIVRAT ! (42 membres)");
  assert.ok(Array.isArray(payload.files) && payload.files.length === 1, "card file attached");
  assert.equal(payload.files[0].name, "welcome-card.png");
  assert.equal(payload.files[0].attachment.subarray(1, 4).toString(), "PNG");
});

test("card subtitle keeps every documented placeholder working on the card", async () => {
  const requests = [];
  const registry = new WelcomeTemplateRegistry(); registry.discover();
  const pipeline = { generate: async (request, template) => { requests.push({ request, template }); return { buffer: Buffer.from("png"), contentType: "image/png" }; } };
  const delivery = new WelcomeDeliveryService({
    renderer: new WelcomeTemplateRenderer({ providers: defaultPlaceholderProviders() }),
    imagePipeline: pipeline,
    templateRegistry: registry,
  });
  await delivery.welcome(member, welcomeConfig({
    welcome_message: "{user} {mention} {username} {displayname} {userid} {server} {membercount} {joindate}",
  }), { sendChannelMessage: async () => {} });
  const subtitle = requests[0].request.textElements.find((element) => element.id === "subtitle").content;
  assert.equal(subtitle, "@nina @nina nina Nina user-1 CIVRAT 42 11/08/2026");
  assert.equal(requests[0].request.avatarUrl, "https://cdn.example/nina.png");
  assert.equal(requests[0].template.id, "template-1", "default template used when none is configured");
});

test("an unknown configured template falls back to template-1", async () => {
  const requests = [];
  const registry = new WelcomeTemplateRegistry(); registry.discover();
  const delivery = new WelcomeDeliveryService({
    renderer: new WelcomeTemplateRenderer({ providers: defaultPlaceholderProviders() }),
    imagePipeline: { generate: async (request, template) => { requests.push(template); return { buffer: Buffer.from("png"), contentType: "image/png" }; } },
    templateRegistry: registry,
  });
  await delivery.welcome(member, welcomeConfig({ welcome_template_id: "template-does-not-exist" }), { sendChannelMessage: async () => {} });
  assert.equal(requests[0].id, "template-1");
});

test("card generation failure never blocks the text delivery", async () => {
  const events = [];
  const delivery = new WelcomeDeliveryService({
    renderer: new WelcomeTemplateRenderer({ providers: defaultPlaceholderProviders() }),
    imagePipeline: { generate: async () => { throw new Error("render exploded"); } },
    templateRegistry: (() => { const registry = new WelcomeTemplateRegistry(); registry.discover(); return registry; })(),
    logService: { failure: (event) => events.push(event), delivery: (event) => events.push(event) },
  });
  const sent = [];
  await delivery.welcome(member, welcomeConfig(), { sendChannelMessage: async (...args) => sent.push(args) });
  assert.equal(sent.length, 1, "text welcome still sent");
  assert.equal(sent[0][1].files, undefined, "no attachment when the card fails");
  assert.ok(events.some((event) => event.type === "DELIVERY_UNAVAILABLE"));
});

test("goodbye delivery never attaches a card (non-regression)", async () => {
  const sent = [];
  const delivery = createDelivery();
  await delivery.goodbye(member, {
    goodbye_enabled: true,
    goodbye_channel_id: "channel-9",
    goodbye_message: "Au revoir {username}",
    goodbye_embed_enabled: false,
    welcome_template_id: "template-3",
  }, { sendChannelMessage: async (...args) => sent.push(args) });
  assert.equal(sent.length, 1);
  assert.equal(sent[0][1].content, "Au revoir nina");
  assert.equal(sent[0][1].files, undefined, "goodbye must never carry the welcome card");
});

test("welcome delivery without image pipeline keeps the historical exact payload", async () => {
  const sent = [];
  const delivery = new WelcomeDeliveryService({
    renderer: new WelcomeTemplateRenderer({ providers: defaultPlaceholderProviders() }),
  });
  await delivery.welcome({ guildId: "guild", user: "@user" }, {
    welcome_enabled: true,
    welcome_channel_id: "channel",
    welcome_message: "Hi {user}",
    welcome_embed_enabled: false,
  }, { sendChannelMessage: async (...args) => sent.push(args) });
  assert.deepEqual(sent, [["channel", { content: "Hi @user", embed: null }]]);
});
