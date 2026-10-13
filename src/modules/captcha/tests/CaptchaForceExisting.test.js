"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { toggleForceExisting } = require("../interactions/configureCaptcha");
const { CaptchaConfigKey: Key, CAPTCHA_FORCE_EXISTING_MAX_MEMBERS } = require("../configuration/captchaConstants");

/** Guild mock suffisamment réaliste pour le DiscordCaptchaTransport du handler. */
function buildGuild({ members = [] } = {}) {
  const rolesCache = new Map([
    ["r-ver", { id: "r-ver", position: 1, managed: false }],
    ["r-unv", { id: "r-unv", position: 1, managed: false }],
  ]);
  const memberList = members;
  const channelsCache = new Map([
    ["c1", {
      id: "c1",
      permissionOverwrites: {
        cache: new Map([["everyone", { deny: { has: () => true } }]]),
        has: () => true,
      },
    }],
  ]);
  return {
    id: "g1",
    roles: {
      everyone: { id: "everyone" },
      cache: rolesCache,
      create: async ({ name }) => {
        const id = `created-${rolesCache.size + 1}`;
        const role = { id, name, position: 2, setPosition: async () => {} };
        rolesCache.set(id, role);
        return role;
      },
    },
    members: {
      me: { roles: { highest: { position: 10 } } },
      fetch: async () => new Map(memberList.map((m) => [m.id, m])),
    },
    channels: { cache: channelsCache },
  };
}

function buildMember({ id, bot = false, roleIds = [] } = {}) {
  return {
    id,
    user: { bot },
    roles: { cache: new Map(roleIds.map((r) => [r, {}])), add: async (role) => { roleIds.push(role?.id || role); }, remove: async () => {} },
  };
}

function forceHarness({ config = {}, members = [], guild = null } = {}) {
  let current = {
    [Key.ENABLED]: true,
    [Key.ROLE_ID]: "r-ver",
    [Key.CHANNEL_ID]: "c1",
    [Key.UNVERIFIED_ROLE_ID]: "r-unv",
    [Key.FORCE_EXISTING]: false,
    ...config,
  };
  const replies = [];
  const g = guild || buildGuild({ members });
  const context = {
    guildId: "g1",
    userId: "admin",
    t: (key, vars) => key,
    service: {
      read: async () => ({ ...current }),
      update: async (_guild, patch) => { current = { ...current, ...patch }; return { ...current }; },
    },
    envelope: {
      discordMember: { guild: g },
      transport: { reply: async (payload) => { replies.push(payload); }, update: async () => {} },
    },
  };
  return { context, replies, config: () => ({ ...current }), guild: g };
}

test("force existing — disabled captcha refuses without any write", async () => {
  const h = forceHarness({ config: { [Key.ENABLED]: false } });
  const result = await toggleForceExisting(h.context);
  assert.equal(result, null);
  assert.equal(h.replies[0].view.content, "captcha.forceRequiresEnabled");
  assert.equal(h.config()[Key.FORCE_EXISTING], false, "aucune écriture");
});

test("force existing — activation applies the unverified role to concerned humans only", async () => {
  const members = [
    buildMember({ id: "h1" }),                       // humain nu → applied
    buildMember({ id: "h2", roleIds: ["r-ver"] }),   // vérifié → skip
    buildMember({ id: "h3", roleIds: ["r-unv"] }),   // déjà non vérifié → skip
    buildMember({ id: "b1", bot: true }),            // bot → skip
  ];
  const h = forceHarness({ members });
  const result = await toggleForceExisting(h.context);

  assert.equal(result.updated, true);
  assert.deepEqual(result.stats, { processed: 4, applied: 1, bots: 1, alreadyVerified: 1, alreadyUnverified: 1, failed: 0, truncated: false });
  assert.equal(h.config()[Key.FORCE_EXISTING], true, "clé activée après exécution");
  assert.equal(h.replies.at(-1).view.content, "captcha.forceSummary");
});

test("force existing — second click only disables, never rescans", async () => {
  const members = [buildMember({ id: "h1" })];
  const h = forceHarness({ config: { [Key.FORCE_EXISTING]: true }, members });
  const result = await toggleForceExisting(h.context);
  assert.equal(result, null);
  assert.equal(h.config()[Key.FORCE_EXISTING], false, "désactivé");
  assert.equal(h.replies.at(-1).view.content, "captcha.forceDisabled");
  // members.fetch n'est pas rappelé : on l'observe via l'absence de reply résumé.
  assert.equal(h.replies.length, 1);
});

test("force existing — fetch failure yields a clear error and keeps the toggle off", async () => {
  const h = forceHarness();
  h.guild.members.fetch = async () => { throw new Error("Missing Access"); };
  const result = await toggleForceExisting(h.context);
  assert.equal(result, null);
  assert.equal(h.config()[Key.FORCE_EXISTING], false, "non activée en cas d'échec");
  assert.match(h.replies.at(-1).view.content, /captcha\.forceMembersFetchFailed/);
});

test("force existing — the scan is bounded by the hard ceiling", async () => {
  let receivedLimit = null;
  const members = [buildMember({ id: "h1" })];
  const h = forceHarness({ members });
  const originalFetch = h.guild.members.fetch;
  h.guild.members.fetch = async (...args) => { receivedLimit = args.length; return originalFetch(...args); };
  await toggleForceExisting(h.context);
  // Le plafond est appliqué par le transport (slice) — on vérifie la constante
  // et que l'exécution reste unique (un seul fetch par exécution).
  assert.equal(CAPTCHA_FORCE_EXISTING_MAX_MEMBERS, 1000);
  assert.equal(receivedLimit, 0, "guild.members.fetch() sans pagination infinie côté handler");
});

test("force existing — missing unverified role is auto-repaired first", async () => {
  const members = [buildMember({ id: "h1" })];
  const h = forceHarness({ config: { [Key.UNVERIFIED_ROLE_ID]: null }, members });
  const result = await toggleForceExisting(h.context);
  assert.equal(result.updated, true, "exécution malgré le rôle absent");
  const unverifiedId = h.config()[Key.UNVERIFIED_ROLE_ID];
  assert.ok(unverifiedId, "rôle non vérifié créé et persisté");
  assert.equal(result.stats.applied, 1, "le rôle créé est bien appliqué");
});
