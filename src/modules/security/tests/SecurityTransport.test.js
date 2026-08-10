"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { DiscordSecurityTransport } = require("../../../adapters/discord/DiscordSecurityTransport");

function guildWith(members) {
  return {
    members: {
      fetch: async (id) => {
        const m = members[id];
        if (!m) return null;
        // mimic Discord member
        return m;
      },
    },
    channels: { cache: new Map() },
  };
}

test("fetchMember returns null when not found", async () => {
  const transport = new DiscordSecurityTransport({ guild: guildWith({}) });
  assert.equal(await transport.fetchMember("123"), null);
  assert.equal(await transport.fetchMember(null), null);
});

test("isModeratable and isBot checks", async () => {
  const transport = new DiscordSecurityTransport({ guild: guildWith({}) });
  assert.equal(transport.isModeratable({ moderatable: true }), true);
  assert.equal(transport.isModeratable({ moderatable: false }), false);
  assert.equal(transport.isModeratable(null), false);
  assert.equal(transport.isBot({ user: { bot: true } }), true);
  assert.equal(transport.isBot({ user: { bot: false } }), false);
  assert.equal(transport.isBot({}), false);
});

test("fetchChannel returns null when not found", async () => {
  const guild = { channels: { cache: new Map([["1", { id: "1" }]]) } };
  const transport = new DiscordSecurityTransport({ guild });
  assert.equal(await transport.fetchChannel("1"), guild.channels.cache.get("1"));
  assert.equal(await transport.fetchChannel("999"), null);
});
