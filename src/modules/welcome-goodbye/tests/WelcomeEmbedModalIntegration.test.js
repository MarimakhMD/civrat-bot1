"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { openWelcomeEmbedColorModal, submitWelcomeEmbedColor } = require("../interactions/welcomeEmbedColorModal");

test("embed color modal opens with saved color and persists valid submission", async () => {
  let saved;
  const modals = [];
  const updates = [];
  const settings = {
    get: async () => ({ welcome_embed_color: "#00e85c", welcome_embed_enabled: true }),
    update: async (_guildId, patch) => { saved = patch; return { welcome_embed_color: patch.welcome_embed_color, welcome_embed_enabled: true }; },
  };
  const base = { guildId: "guild", t: (key) => key, settings };
  await openWelcomeEmbedColorModal({ ...base, config: await settings.get("guild"), envelope: { transport: { showModal: async (modal) => modals.push(modal) } } });
  await submitWelcomeEmbedColor({ ...base, envelope: { fields: { color: "#123456" }, transport: { update: async (view) => updates.push(view) } } });
  assert.equal(modals[0].fields[0].value, "#00e85c");
  assert.equal(saved.welcome_embed_color, "#123456");
  assert.equal(updates.length, 1);
});
