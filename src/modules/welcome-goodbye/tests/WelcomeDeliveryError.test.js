"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeWelcomeDeliveryError } = require("../services/WelcomeDeliveryError");

test("delivery failures are normalized without exposing transport details", () => {
  const error = normalizeWelcomeDeliveryError(new Error("Missing Permissions"), { guildId: "guild" });
  assert.equal(error.metadata.reason, "channel_unavailable");
  assert.equal(error.metadata.guildId, "guild");
});
