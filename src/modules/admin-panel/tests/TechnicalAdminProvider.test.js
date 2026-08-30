"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createFakeGuildMember } = require("../../../core/testing/fakeGuildMember");
const { TechnicalAdminProvider } = require("../services/TechnicalAdminProvider");

const GUILD_ID = "1320817768962064384";
const CHANNEL_ID = "1542957356382552154";
const ROLE_ID = "1542958959907053688";

function provider(overrides = {}) {
  return new TechnicalAdminProvider({
    guildId: GUILD_ID,
    channelId: CHANNEL_ID,
    roleId: ROLE_ID,
    ...overrides,
  });
}

function context({ guildId = GUILD_ID, channelId = CHANNEL_ID, roleIds = [ROLE_ID] } = {}) {
  return {
    guildId,
    channelId,
    member: createFakeGuildMember({ roleIds }),
  };
}

test("technical admin requires the configured guild, channel, and role together", async () => {
  assert.equal(await provider().isAdmin(context()), true);
});

test("technical admin is refused outside the configured guild", async () => {
  assert.equal(await provider().isAdmin(context({ guildId: "999999999999999999" })), false);
});

test("technical admin is refused outside the configured channel", async () => {
  assert.equal(await provider().isAdmin(context({ channelId: "999999999999999999" })), false);
});

test("technical admin is refused without the configured role", async () => {
  assert.equal(await provider().isAdmin(context({ roleIds: [] })), false);
});

test("missing or malformed technical configuration fails closed", async () => {
  for (const overrides of [
    { guildId: null },
    { channelId: "not-a-snowflake" },
    { roleId: "" },
  ]) {
    const authority = provider(overrides);
    assert.equal(authority.isConfigured(), false);
    assert.equal(await authority.isAdmin(context()), false);
  }
});

test("missing member capability fails closed", async () => {
  assert.equal(await provider().isAdmin({ guildId: GUILD_ID, channelId: CHANNEL_ID, member: null }), false);
});
