"use strict";

// A3 — récompenses de rôle par niveau.
//
// Ces tests composent les VRAIS AutoRoleEligibilityService et
// AutoRoleAssignmentService : la matrice d'éligibilité n'est pas doublée, donc
// un changement de comportement autorole se voit ici plutôt qu'en production.
// Seul le transport Discord (member.roles.add) est un double, comme le font
// déjà les tests autorole du dépôt.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  XPLevelRewardService,
  validateRoleRewards,
  parseRoleRewards,
  resolveRewardRoleIds,
} = require("../services/XPLevelRewardService");
const { DiscordAutoRoleTransport } = require("../../autorole/services/DiscordAutoRoleTransport");
const { AutoRoleAssignmentService } = require("../../autorole/services/AutoRoleAssignmentService");
const { XP_DEFAULTS, XPConfigKey, XP_REWARD_LIMITS } = require("../configuration/xpConstants");
const { isGuildConfigKey } = require("../../../services/guildConfigKeys");
const { createXPRuntime } = require("../runtime/createXPRuntime");
const { InMemoryXPRepository } = require("../persistence/XPRepository");

const R1 = "111111111111111111";
const R5 = "555555555555555555";
const R10 = "101010101010101010";

/** Guilde Discord minimale. `roles` mappe id -> { managed, position }. */
function makeGuild({ roles = {}, botPosition = 5, canManageRoles = true, hasMe = true } = {}) {
  const cache = new Map(
    Object.entries(roles).map(([id, opts = {}]) => [
      id,
      { id, managed: Boolean(opts.managed), position: Number.isFinite(opts.position) ? opts.position : 1 },
    ]),
  );
  return {
    id: "g",
    roles: { cache },
    members: hasMe
      ? {
          me: {
            permissions: { has: (perm) => (perm === "ManageRoles" ? canManageRoles : true) },
            roles: { highest: { position: botPosition } },
          },
        }
      : { me: null },
  };
}

/** Membre Discord minimal. `add` compte les appels et peut lever. */
function makeMember({ id = "u", existing = [], manageable = true, isBot = false, fails = false } = {}) {
  const calls = { add: [], remove: 0 };
  return {
    calls,
    member: {
      id,
      user: { bot: isBot },
      manageable,
      roles: {
        cache: new Map(existing.map((roleId) => [roleId, { id: roleId }])),
        add: async (role) => {
          calls.add.push(role.id);
          if (fails) throw new Error("Missing Permissions");
        },
        remove: async () => {
          calls.remove += 1;
        },
      },
    },
  };
}

/** Service A3 câblé sur les vrais services autorole, transport contrôlé. */
function makeService({ fails = false, logger = null } = {}) {
  return new XPLevelRewardService({
    assignmentService: new AutoRoleAssignmentService({
      transport: fails
        ? { assignRole: async () => { throw new Error("Missing Permissions"); } }
        : new DiscordAutoRoleTransport(),
    }),
    logger,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation du format canonique
// ─────────────────────────────────────────────────────────────────────────────

test("A3 — la configuration canonique est acceptée et normalisée", () => {
  const { valid, reason, rewards } = validateRoleRewards([
    { level: 5, role_ids: [R5, R10] },
    { level: 1, role_ids: [R1] },
  ]);
  assert.equal(valid, true);
  assert.equal(reason, null);
  assert.deepEqual(rewards.map((r) => r.level), [1, 5], "tri croissant par niveau, indépendant de l'ordre stocké");
  assert.deepEqual(rewards[0].roleIds, [R1]);
  assert.deepEqual(rewards[1].roleIds, [R5, R10]);
});

test("A3 — niveau dupliqué : toute la configuration est rejetée (décision 6)", () => {
  const { valid, reason, rewards } = validateRoleRewards([
    { level: 1, role_ids: [R1] },
    { level: 1, role_ids: [R5] },
  ]);
  assert.equal(valid, false);
  assert.equal(reason, "DUPLICATE_LEVEL");
  assert.deepEqual(rewards, []);
});

test("A3 — validation stricte des niveaux et des identifiants (décision 7)", () => {
  const cases = [
    [{ level: 0, role_ids: [R1] }, "INVALID_LEVEL"],
    [{ level: -1, role_ids: [R1] }, "INVALID_LEVEL"],
    [{ level: 1.5, role_ids: [R1] }, "INVALID_LEVEL"],
    [{ level: "1", role_ids: [R1] }, "INVALID_LEVEL"],
    [{ level: 1, role_ids: [] }, "EMPTY_ROLE_IDS"],
    [{ level: 1, role_ids: R1 }, "INVALID_ROLE_IDS"],
    [{ level: 1 }, "INVALID_ROLE_IDS"],
    [{ level: 1, role_ids: ["abc"] }, "INVALID_ROLE_ID"],
    [{ level: 1, role_ids: ["12345678901234"] }, "INVALID_ROLE_ID"],
    [{ level: 1, role_ids: ["12345678901234567890123"] }, "INVALID_ROLE_ID"],
    [{ level: 1, role_ids: [null] }, "INVALID_ROLE_ID"],
  ];
  for (const [entry, expected] of cases) {
    const result = validateRoleRewards([entry]);
    assert.equal(result.valid, false, `${JSON.stringify(entry)} doit être rejeté`);
    assert.equal(result.reason, expected);
    assert.deepEqual(result.rewards, []);
  }
});

test("A3 — bornes : 10 rôles par entrée, 100 entrées (décision 5)", () => {
  assert.equal(XP_REWARD_LIMITS.MAX_ROLES_PER_ENTRY, 10);
  assert.equal(XP_REWARD_LIMITS.MAX_ENTRIES, 100);

  assert.equal(validateRoleRewards([{ level: 1, role_ids: Array(10).fill(R1) }]).valid, true, "10 rôles = borne atteinte, accepté");
  assert.equal(validateRoleRewards([{ level: 1, role_ids: Array(11).fill(R1) }]).reason, "TOO_MANY_ROLES");

  const hundred = Array.from({ length: 100 }, (_, i) => ({ level: i + 1, role_ids: [R1] }));
  assert.equal(validateRoleRewards(hundred).valid, true);
  assert.equal(validateRoleRewards([...hundred, { level: 101, role_ids: [R1] }]).reason, "TOO_MANY_ENTRIES");
});

test("A3 — parsing défensif : aucune valeur ne lève ni n'attribue (décision 18)", () => {
  const hostile = [
    null, undefined, 0, 42, "", "[]", {}, true, NaN,
    [null], [undefined], [1], ["x"], [[]],
    [{ level: 1, role_ids: [R1], __proto__: { polluted: true } }],
  ];
  for (const value of hostile) {
    let parsed;
    assert.doesNotThrow(() => { parsed = validateRoleRewards(value); }, `${String(value)} ne doit pas lever`);
    assert.deepEqual(parsed.rewards, [], `${String(value)} ne doit produire aucune récompense`);
    assert.deepEqual(parseRoleRewards(value), []);
  }
  assert.equal(({}).polluted, undefined, "aucune pollution de prototype");
});

test("A3 — [] et null sont des valeurs vides VALIDES, pas des erreurs (décision 17)", () => {
  for (const value of [[], null, undefined]) {
    const result = validateRoleRewards(value);
    assert.equal(result.valid, true, `${String(value)} est une absence de configuration, pas une faute`);
    assert.equal(result.reason, "EMPTY");
    assert.deepEqual(result.rewards, []);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Résolution du saut de niveaux
// ─────────────────────────────────────────────────────────────────────────────

test("A3 — le saut multi-niveaux attribue tout ]previousLevel, level] (décision 9)", () => {
  const rewards = parseRoleRewards([
    { level: 10, role_ids: [R10] },
    { level: 1, role_ids: [R1] },
    { level: 5, role_ids: [R5] },
  ]);

  assert.deepEqual(resolveRewardRoleIds({ roleRewards: rewards, previousLevel: 0, level: 10 }), [R1, R5, R10]);
  assert.deepEqual(resolveRewardRoleIds({ roleRewards: rewards, previousLevel: 0, level: 4 }), [R1]);
  assert.deepEqual(resolveRewardRoleIds({ roleRewards: rewards, previousLevel: 1, level: 5 }), [R5]);
  assert.deepEqual(resolveRewardRoleIds({ roleRewards: rewards, previousLevel: 5, level: 10 }), [R10]);
  assert.deepEqual(resolveRewardRoleIds({ roleRewards: rewards, previousLevel: 10, level: 10 }), [], "aucun niveau franchi");
  assert.deepEqual(resolveRewardRoleIds({ roleRewards: rewards, previousLevel: 2, level: 1 }), [], "recul impossible");
});

// ─────────────────────────────────────────────────────────────────────────────
// Attribution
// ─────────────────────────────────────────────────────────────────────────────

test("A3 — rôle attribué au niveau exact", async () => {
  const guild = makeGuild({ roles: { [R1]: { position: 1 } } });
  const { member, calls } = makeMember();
  const result = await makeService().grant({
    guild, member, previousLevel: 0, level: 1,
    config: { xp_enabled: true, role_rewards: [{ level: 1, role_ids: [R1] }] },
  });

  assert.deepEqual(result.granted, [R1]);
  assert.deepEqual(result.skipped, []);
  assert.deepEqual(result.failed, []);
  assert.deepEqual(calls.add, [R1], "roles.add appelé exactement une fois");
});

test("A3 — plusieurs rôles au même niveau (décision 4)", async () => {
  const guild = makeGuild({ roles: { [R1]: {}, [R5]: {} } });
  const { member, calls } = makeMember();
  const result = await makeService().grant({
    guild, member, previousLevel: 4, level: 5,
    config: { role_rewards: [{ level: 5, role_ids: [R1, R5] }] },
  });

  assert.deepEqual(result.granted, [R1, R5]);
  assert.deepEqual(calls.add, [R1, R5]);
});

test("A3 — saut de 0 à 10 attribue les niveaux 1, 5 et 10", async () => {
  const guild = makeGuild({ roles: { [R1]: {}, [R5]: {}, [R10]: {} } });
  const { member, calls } = makeMember();
  const result = await makeService().grant({
    guild, member, previousLevel: 0, level: 10,
    config: { role_rewards: [
      { level: 1, role_ids: [R1] },
      { level: 5, role_ids: [R5] },
      { level: 10, role_ids: [R10] },
    ] },
  });

  assert.deepEqual(result.granted, [R1, R5, R10]);
  assert.deepEqual(calls.add, [R1, R5, R10]);
});

test("A3 — niveau dupliqué : rien n'est attribué", async () => {
  const guild = makeGuild({ roles: { [R1]: {}, [R5]: {} } });
  const { member, calls } = makeMember();
  const result = await makeService().grant({
    guild, member, previousLevel: 0, level: 5,
    config: { role_rewards: [{ level: 5, role_ids: [R5] }, { level: 5, role_ids: [R1] }] },
  });

  assert.equal(result.reason, "DUPLICATE_LEVEL");
  assert.deepEqual(result.granted, []);
  assert.deepEqual(calls.add, [], "aucun appel à roles.add");
});

test("A3 — matrice autorole : les six refus sont repris tels quels (décision 10)", async () => {
  const cases = [
    ["rôle supprimé", { roles: {} }, makeMember(), "ROLE_MISSING"],
    ["rôle géré", { roles: { [R1]: { managed: true } } }, makeMember(), "ROLE_MANAGED"],
    ["bot sans ManageRoles", { roles: { [R1]: {} }, canManageRoles: false }, makeMember(), "MANAGE_ROLES_MISSING"],
    ["rôle trop haut", { roles: { [R1]: { position: 5 } }, botPosition: 5 }, makeMember(), "ROLE_TOO_HIGH"],
    ["rôle au-dessus du bot", { roles: { [R1]: { position: 9 } }, botPosition: 5 }, makeMember(), "ROLE_TOO_HIGH"],
    ["membre non gérable", { roles: { [R1]: {} } }, makeMember({ manageable: false }), "MEMBER_UNMANAGEABLE"],
    ["rôle déjà présent", { roles: { [R1]: {} } }, makeMember({ existing: [R1] }), "MEMBER_ALREADY_HAS_ROLE"],
  ];

  for (const [label, guildOpts, memberPair, expected] of cases) {
    const guild = makeGuild(guildOpts);
    const result = await makeService().grant({
      guild,
      member: memberPair.member,
      previousLevel: 0,
      level: 1,
      config: { role_rewards: [{ level: 1, role_ids: [R1] }] },
    });
    assert.deepEqual(result.granted, [], `${label} : rien ne doit être attribué`);
    assert.deepEqual(result.skipped.map((s) => s.code), [expected], `${label} → ${expected}`);
    assert.deepEqual(memberPair.calls.add, [], `${label} : roles.add ne doit pas être appelé`);
  }
});

test("A3 — guilde indisponible (members.me nul) : refus propre, aucune exception", async () => {
  const guild = makeGuild({ roles: { [R1]: {} }, hasMe: false });
  const { member, calls } = makeMember();
  const result = await makeService().grant({
    guild, member, previousLevel: 0, level: 1,
    config: { role_rewards: [{ level: 1, role_ids: [R1] }] },
  });

  assert.deepEqual(result.granted, []);
  assert.deepEqual(result.skipped.map((s) => s.code), ["MANAGE_ROLES_MISSING"]);
  assert.deepEqual(calls.add, []);
});

test("A3 — erreur Discord absorbée et journalisée, grant() ne lève pas (décision 11)", async () => {
  const guild = makeGuild({ roles: { [R1]: {}, [R5]: {} } });
  const { member } = makeMember({ fails: true });
  const warnings = [];
  const service = makeService({ fails: true, logger: { warn: (msg, details) => warnings.push([msg, details]) } });

  // NB : assert.doesNotReject résout à undefined, pas à la valeur renvoyée par
  // la fonction. Le résultat doit donc être capturé par effet de bord.
  let result;
  await assert.doesNotReject(
    async () => {
      result = await service.grant({
        guild, member, previousLevel: 0, level: 5,
        config: { role_rewards: [{ level: 1, role_ids: [R1] }, { level: 5, role_ids: [R5] }] },
      });
    },
    "une erreur Discord ne doit jamais remonter",
  );

  assert.deepEqual(result.granted, []);
  assert.deepEqual(result.failed.map((f) => f.code), ["DISCORD_ASSIGNMENT_FAILED", "DISCORD_ASSIGNMENT_FAILED"]);
  assert.equal(warnings.length, 2, "chaque échec est journalisé");
});

test("A3 — config null, invalide ou vide : aucune attribution, aucune exception", async () => {
  const guild = makeGuild({ roles: { [R1]: {} } });

  for (const [label, roleRewards, expectedReason] of [
    ["absente (undefined)", undefined, null],
    ["null", null, null],
    ["tableau vide", [], null],
    ["mauvais type (objet)", { level: 1, role_ids: [R1] }, "NOT_AN_ARRAY"],
    ["chaîne", "[]", "NOT_AN_ARRAY"],
    ["entrée invalide", [{ level: 1, role_ids: ["abc"] }], "INVALID_ROLE_ID"],
  ]) {
    const { member, calls } = makeMember();
    const result = await makeService().grant({
      guild, member, previousLevel: 0, level: 5,
      config: { xp_enabled: true, role_rewards: roleRewards },
    });
    assert.deepEqual(result.granted, [], `${label} : rien ne doit être attribué`);
    assert.deepEqual(calls.add, [], `${label} : aucun appel à roles.add`);
    assert.equal(result.reason, expectedReason, `${label} → reason attendu`);
  }
});

test("A3 — aucun retrait de rôle : les récompenses sont cumulatives (décision 8)", async () => {
  const guild = makeGuild({ roles: { [R1]: {}, [R5]: {} } });
  const { member, calls } = makeMember({ existing: [R1] });

  const result = await makeService().grant({
    guild, member, previousLevel: 1, level: 5,
    config: { role_rewards: [{ level: 1, role_ids: [R1] }, { level: 5, role_ids: [R5] }] },
  });

  assert.deepEqual(result.granted, [R5], "seul le niveau franchi est attribué");
  assert.deepEqual(result.skipped.map((s) => s.code), [], "le niveau 1 n'est pas dans ]1,5]");
  assert.equal(calls.remove, 0, "roles.remove ne doit JAMAIS être appelé");
});

test("A3 — un même rôle porté par deux niveaux franchis n'est attribué qu'une fois", async () => {
  const guild = makeGuild({ roles: { [R1]: {} } });
  const { member, calls } = makeMember();

  const result = await makeService().grant({
    guild, member, previousLevel: 0, level: 2,
    config: { role_rewards: [{ level: 1, role_ids: [R1] }, { level: 2, role_ids: [R1] }] },
  });

  assert.deepEqual(result.granted, [R1]);
  assert.deepEqual(calls.add, [R1], "un seul appel à roles.add");
});

test("A3 — membre bot et entrée invalide : sorties propres", async () => {
  const guild = makeGuild({ roles: { [R1]: {} } });

  const bot = makeMember({ isBot: true });
  const botResult = await makeService().grant({
    guild, member: bot.member, previousLevel: 0, level: 1,
    config: { role_rewards: [{ level: 1, role_ids: [R1] }] },
  });
  assert.equal(botResult.reason, "BOT_MEMBER");
  assert.deepEqual(botResult.granted, []);
  assert.deepEqual(bot.calls.add, []);

  const noInput = await makeService().grant({});
  assert.equal(noInput.reason, "INVALID_INPUT");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bout en bout : l'XP survit à l'échec d'attribution
// ─────────────────────────────────────────────────────────────────────────────

test("A3 — l'XP reste acquise même si l'attribution du rôle échoue (décision 11)", async () => {
  const repository = new InMemoryXPRepository({ clock: () => 0 });
  const guild = makeGuild({ roles: { [R1]: {} } });
  const { member } = makeMember({ fails: true });

  const runtime = createXPRuntime({
    configService: {
      read: async () => ({
        xp_enabled: true,
        xp_per_message: 100,
        xp_cooldown: 0,
        role_rewards: [{ level: 1, role_ids: [R1] }],
      }),
    },
    repository,
    rewardServiceFactory: () => makeService({ fails: true }),
  });

  const res = await runtime.handleMessage({
    guild,
    member,
    author: { id: "u", bot: false },
  });

  assert.equal(res.code, "XP_LEVELED_UP", "le level-up est bien détecté");
  assert.equal(res.xp, 100, "l'XP est acquise malgré l'échec du rôle");
  assert.equal(res.level, 1);
  assert.deepEqual(res.rewardOutcome.granted, []);
  assert.deepEqual(res.rewardOutcome.failed.map((f) => f.code), ["DISCORD_ASSIGNMENT_FAILED"]);

  const stored = await repository.findOne("g", "u");
  assert.equal(stored.xp, 100, "l'XP est bien persistée");
  assert.equal(stored.level, 1);
});

test("A3 — bout en bout : le rôle est attribué sur le crochet de level-up existant", async () => {
  const repository = new InMemoryXPRepository({ clock: () => 0 });
  const guild = makeGuild({ roles: { [R1]: {} } });
  const { member, calls } = makeMember();

  const runtime = createXPRuntime({
    configService: {
      read: async () => ({
        xp_enabled: true,
        xp_per_message: 100,
        xp_cooldown: 0,
        role_rewards: [{ level: 1, role_ids: [R1] }],
      }),
    },
    repository,
  });

  const res = await runtime.handleMessage({ guild, member, author: { id: "u", bot: false } });

  assert.equal(res.code, "XP_LEVELED_UP");
  assert.deepEqual(res.rewardOutcome.granted, [R1]);
  assert.deepEqual(calls.add, [R1]);
});

test("A3 — aucun level-up : aucune récompense évaluée", async () => {
  const repository = new InMemoryXPRepository({ clock: () => 0 });
  const guild = makeGuild({ roles: { [R1]: {} } });
  const { member, calls } = makeMember();
  let grantCalls = 0;

  const runtime = createXPRuntime({
    configService: {
      read: async () => ({
        xp_enabled: true,
        xp_per_message: 10,
        xp_cooldown: 0,
        role_rewards: [{ level: 1, role_ids: [R1] }],
      }),
    },
    repository,
    rewardServiceFactory: () => ({
      grant: async () => { grantCalls += 1; return { granted: [], skipped: [], failed: [], reason: null }; },
    }),
  });

  const res = await runtime.handleMessage({ guild, member, author: { id: "u", bot: false } });

  assert.equal(res.code, "XP_GAINED");
  assert.equal(grantCalls, 0, "grant() ne doit pas être appelé sans level-up");
  assert.equal(res.rewardOutcome, undefined, "le résultat reste inchangé");
  assert.deepEqual(calls.add, []);
});

// ─────────────────────────────────────────────────────────────────────────────
// Non-régression A2 / B3
// ─────────────────────────────────────────────────────────────────────────────

test("A3 — non-régression A2 : clés, défauts et colonnes fantômes inchangés", () => {
  assert.equal(XPConfigKey.ENABLED, "xp_enabled");
  assert.equal(XPConfigKey.PER_MESSAGE, "xp_per_message");
  assert.equal(XPConfigKey.COOLDOWN, "xp_cooldown");
  assert.equal(XPConfigKey.ROLE_REWARDS, "role_rewards");

  assert.equal(XP_DEFAULTS.xp_enabled, false);
  assert.equal(XP_DEFAULTS.xp_per_message, 15, "gain fixe A2 (DCA3) préservé");
  assert.equal(XP_DEFAULTS.xp_cooldown, 60, "cooldown A2 (DCA5) préservé");
  assert.deepEqual(XP_DEFAULTS.role_rewards, [], "décision 17 : [] comme valeur vide");

  // A2 (DCA3/DCA4) — les colonnes fantômes ne doivent pas réapparaître.
  for (const phantom of ["xp_rate", "xp_channel_id"]) {
    assert.equal(XPConfigKey[phantom.toUpperCase()], undefined);
    assert.equal(isGuildConfigKey(phantom), false, `${phantom} doit rester refusé`);
  }
  assert.equal(XP_DEFAULTS.xp_rate, undefined);
  assert.equal(XP_DEFAULTS.xp_channel_id, undefined);
});

test("A3 — décision 2 : level_rewards reste hors whitelist et hors XPConfigKey", () => {
  assert.equal(isGuildConfigKey("level_rewards"), false, "level_rewards ne doit pas être inscriptible");
  assert.equal(isGuildConfigKey("role_rewards"), true, "role_rewards doit l'être");
  assert.equal(XPConfigKey.LEVEL_REWARDS, undefined);
  assert.equal(XP_DEFAULTS.level_rewards, undefined);

  const values = Object.values(XPConfigKey);
  assert.deepEqual(values.sort(), ["role_rewards", "xp_cooldown", "xp_enabled", "xp_per_message"]);
});

test("A3 — décision 15 : aucune UI éditable ajoutée au module XP", () => {
  const { XPComponentId: Id } = require("../configuration/xpConstants");
  assert.deepEqual(Object.keys(Id).sort(), ["BACK", "SECTION", "TOGGLE"],
    "aucun nouveau componentId : la configuration reste en lecture seule");
});

test("A3 — décision 13 : le module XP ne contient aucune instruction SQL", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const dir = path.join(__dirname, "..");
  const files = [];
  (function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      // Les tests sont exclus : celui-ci cite littéralement les motifs
      // interdits pour les rechercher, il se signalerait donc lui-même.
      if (entry.isDirectory()) {
        if (entry.name !== "tests") walk(path.join(current, entry.name));
      } else if (entry.name.endsWith(".js")) {
        files.push(path.join(current, entry.name));
      }
    }
  })(dir);

  assert.ok(files.length >= 10, `le code du module XP doit être parcouru (${files.length} fichiers)`);
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    for (const forbidden of ["CREATE TABLE", "ALTER TABLE", "DROP TABLE", "CREATE POLICY", ".rpc("]) {
      assert.equal(source.toUpperCase().includes(forbidden.toUpperCase()), false,
        `${path.relative(dir, file)} ne doit contenir aucun ${forbidden}`);
    }
  }
});
