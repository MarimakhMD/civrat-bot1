"use strict";

// Phase 11 — câblage V1 Invites : commande publique /invites (même stockage
// que le tracking), sous-vue /settings, Back via settingsHome, clé de
// classement i18n, et option boolean reconnue par l'adaptateur de commandes.

const test = require("node:test");
const assert = require("node:assert/strict");
const { InteractionRegistry } = require("../../../core/interactions");
const { PermissionName } = require("../../../core/permissions");
const { toDiscordCommand } = require("../../../adapters/discord/DiscordCommandAdapter");
const { registerInvites } = require("../register");
const { InviteComponentId: Id } = require("../configuration/inviteConstants");
const { InMemoryInviteStatsRepository } = require("../persistence/InviteStatsRepository");
const { InviteService } = require("../services/InviteService");

const t = (key, params) => (params ? `${key}${JSON.stringify(params)}` : key);

function makeSetup({ store = {} } = {}) {
  const registry = new InteractionRegistry();
  const configService = {
    read: async () => ({ invitations_enabled: true, invitations_log_channel_id: null, ...store }),
    update: async (_g, updates) => Object.assign(store, updates),
  };
  const inviteService = new InviteService({ statsRepository: new InMemoryInviteStatsRepository() });
  let homeCalls = 0;
  const registration = registerInvites({ registry, configService, inviteService, settingsHome: async () => { homeCalls += 1; } });
  return { registry, configService, inviteService, registration, store, homeCalls: () => homeCalls };
}

function context(captured, { leaderboard = false, values = [] } = {}) {
  return {
    guildId: "g",
    t,
    envelope: {
      options: { getUser: () => null, getBoolean: () => leaderboard },
      discordMember: { id: "u1" },
      values,
      transport: { reply: async (p) => { captured.reply = p; }, update: async (p) => { captured.update = p; } },
    },
  };
}

test("registerInvites wires the public command and the MANAGE_GUILD settings routes", () => {
  const { registry, registration } = makeSetup();
  assert.equal(registration.commands.length, 1);
  const command = registry.find({ kind: "command", name: "invites" });
  assert.ok(command);
  assert.equal(command.permissions, null);
  for (const customId of [Id.SECTION, Id.TOGGLE, Id.BACK]) {
    const route = registry.find({ kind: "button", customId });
    assert.ok(route, `${customId} not registered`);
    assert.deepEqual(route.permissions.allOf, [PermissionName.MANAGE_GUILD]);
  }
});

test("/invites leaderboard reads the same repository the tracking writes to", async () => {
  const { registry, inviteService } = makeSetup();
  await inviteService.statsRepository.addInvite("recruiter", "g");
  await inviteService.statsRepository.addInvite("recruiter", "g");
  await inviteService.statsRepository.addInvite("other", "g");
  const captured = {};
  await registry.find({ kind: "command", name: "invites" }).execute(context(captured, { leaderboard: true }));
  assert.ok(captured.reply, "command must reply");
  const content = captured.reply.view.content;
  assert.ok(content.includes('"userId":"recruiter"'), "leaderboard must expose the tracked inviter");
  assert.ok(content.includes('"count":2'), "leaderboard must expose the tracked count");
});

test("/invites without leaderboard option answers the member's own stats", async () => {
  const { registry, inviteService } = makeSetup();
  await inviteService.statsRepository.addInvite("u1", "g");
  const captured = {};
  await registry.find({ kind: "command", name: "invites" }).execute(context(captured));
  assert.ok(captured.reply.view.content.includes('"count":1'), "member stats must come from the shared store");
});

test("settings section renders, toggle flips invitations_enabled, back uses settingsHome", async () => {
  const { registry, store, homeCalls } = makeSetup();
  const captured = {};
  await registry.find({ kind: "button", customId: Id.SECTION }).execute(context(captured));
  assert.ok(captured.update, "section render must update the message");
  assert.equal(captured.update.view.components.length, 2, "toggle + back only (log channel stays in Logs settings)");
  await registry.find({ kind: "button", customId: Id.TOGGLE }).execute(context(captured));
  assert.equal(store.invitations_enabled, false);
  await registry.find({ kind: "button", customId: Id.BACK }).execute(context(captured));
  assert.equal(homeCalls(), 1);
});

test("toDiscordCommand maps the boolean leaderboard option for Discord", () => {
  const { registration } = makeSetup();
  const discord = toDiscordCommand(registration.commands[0], async () => {});
  const json = discord.data.toJSON();
  const leaderboard = json.options.find((o) => o.name === "leaderboard");
  assert.ok(leaderboard, "leaderboard option missing from the Discord definition");
  assert.equal(leaderboard.type, 5); // ApplicationCommandOptionType.Boolean
});

test("invites translations keep EN/FR parity including leaderboardEntry", () => {
  const en = require("../translations/en.json").invites;
  const fr = require("../translations/fr.json").invites;
  assert.deepEqual(Object.keys(en).sort(), Object.keys(fr).sort());
  assert.ok(en.leaderboardEntry && fr.leaderboardEntry);
});
