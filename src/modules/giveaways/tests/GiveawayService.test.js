"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { GiveawayService } = require("../services/GiveawayService");

/**
 * Double de dépôt.
 *
 * `closeIfActive` remplace l'ancien `close` : c'est l'update conditionnel sur
 * `active = true` qui rend la garde anti-double-tirage atomique. Le double
 * reproduit ce contrat — true si la clôture a eu lieu, false si le giveaway
 * était déjà clos.
 */
function mockRepo(overrides = {}) {
  const entries = new Map();
  const calls = [];
  return {
    calls,
    // C1 : signature et colonnes alignées sur le dépôt Supabase réel.
    create: async ({ guildId, channelId, title, winnersCount, duration, endsAt }) => ({
      id: "g1",
      guild_id: guildId,
      channel_id: channelId,
      title,
      winners_count: winnersCount,
      duration,
      ends_at: endsAt,
      active: true,
      status: "active",
    }),
    findById: async (id) => (id === "g1"
      ? { id: "g1", guild_id: "g1", channel_id: "c1", title: "prize", winners_count: 1, active: true, status: "active" }
      : null),
    join: async (gid, uid) => {
      const key = `${gid}:${uid}`;
      if (entries.has(key)) return { alreadyJoined: true };
      entries.set(key, true);
      return { alreadyJoined: false };
    },
    listEntries: async () => ({ entries: [{ user_id: "u1" }, { user_id: "u2" }], total: 2, truncated: false }),
    draw: async () => ({ winners: ["u1"], entriesTotal: 2, truncated: false }),
    closeIfActive: async () => { calls.push("closeIfActive"); return true; },
    ...overrides,
  };
}

const enabled = { read: async () => ({ giveaways_enabled: true }) };

test("create respects disabled and invalid prize", async () => {
  const svc = new GiveawayService({ configService: { read: async () => ({ giveaways_enabled: false }) }, repository: mockRepo() });
  assert.equal((await svc.create({ guildId: "g1", channelId: "c1", title: "prize" })).code, "GIVEAWAY_DISABLED");
  const svc2 = new GiveawayService({ configService: enabled, repository: mockRepo() });
  assert.equal((await svc2.create({ guildId: "g1", channelId: "c1", title: "" })).code, "GIVEAWAY_INVALID_PRIZE");
  assert.equal((await svc2.create({ guildId: "g1", channelId: "c1", title: "a" })).code, "GIVEAWAY_INVALID_PRIZE");
});

test("create requires a channel — il n'existe aucune colonne giveaways_channel_id", async () => {
  const svc = new GiveawayService({ configService: enabled, repository: mockRepo() });
  const res = await svc.create({ guildId: "g1", title: "prize" });
  assert.equal(res.ok, false);
  assert.equal(res.code, "GIVEAWAY_NO_CHANNEL");
});

test("create succeeds and join handles already joined", async () => {
  const svc = new GiveawayService({ configService: enabled, repository: mockRepo() });
  const created = await svc.create({ guildId: "g1", channelId: "c1", title: "prize" });
  assert.equal(created.ok, true);
  assert.equal(created.code, "GIVEAWAY_CREATED");
  assert.equal(created.giveaway.title, "prize");
  assert.equal(created.giveaway.status, "active");
  const join1 = await svc.join({ guildId: "g1", giveawayId: "g1", userId: "u1" });
  assert.equal(join1.ok, true);
  const join2 = await svc.join({ guildId: "g1", giveawayId: "g1", userId: "u1" });
  assert.equal(join2.code, "GIVEAWAY_ALREADY_JOINED");
});

test("join handles not found and closed", async () => {
  const svc = new GiveawayService({
    configService: enabled,
    repository: { findById: async () => null, join: async () => ({}), create: async () => ({}), listEntries: async () => ({ entries: [], total: 0, truncated: false }), draw: async () => ({}), closeIfActive: async () => true },
  });
  assert.equal((await svc.join({ guildId: "g1", giveawayId: "bad", userId: "u1" })).code, "GIVEAWAY_NOT_FOUND");

  // C1 : la garde porte sur le booléen réel `active`, plus sur status !== "open".
  // La valeur réelle par défaut de status est 'active', jamais 'open'.
  const svc2 = new GiveawayService({
    configService: enabled,
    repository: { findById: async () => ({ id: "g1", guild_id: "g1", active: false, status: "ended" }), join: async () => ({}) },
  });
  assert.equal((await svc2.join({ guildId: "g1", giveawayId: "g1", userId: "u1" })).code, "GIVEAWAY_CLOSED");
});

test("draw picks winners and closes", async () => {
  const repository = mockRepo();
  const svc = new GiveawayService({ configService: enabled, repository });
  const res = await svc.draw({ guildId: "g1", giveawayId: "g1" });
  assert.equal(res.ok, true);
  assert.equal(res.code, "GIVEAWAY_DRAWN");
  assert.deepEqual(res.winners, ["u1"]);
  assert.equal(res.entriesTotal, 2);
  assert.equal(res.entriesTruncated, false);
  assert.deepEqual(repository.calls, ["closeIfActive"], "le giveaway doit être clos");
});

test("draw not found", async () => {
  const svc = new GiveawayService({ configService: { read: async () => ({}) }, repository: { findById: async () => null } });
  assert.equal((await svc.draw({ guildId: "g1", giveawayId: "bad" })).code, "GIVEAWAY_NOT_FOUND");
});

test("draw transmet winners_count au dépôt", async () => {
  let received;
  const svc = new GiveawayService({
    configService: enabled,
    repository: {
      findById: async () => ({ id: "g1", guild_id: "g1", winners_count: 3, active: true, status: "active" }),
      draw: async (gid, options) => { received = options; return { winners: ["u1", "u2", "u3"], entriesTotal: 10, truncated: false }; },
      closeIfActive: async () => true,
    },
  });
  await svc.draw({ guildId: "g1", giveawayId: "g1" });
  assert.deepEqual(received, { winnersCount: 3 });
});

test("M5 : 0 participant renvoie GIVEAWAY_NO_PARTICIPANTS et ne clôture PAS", async () => {
  // Avant M5, draw() renvoyait GIVEAWAY_DRAWN avec une liste vide puis close() :
  // le message annonçait « Gagnants : » sans personne et le giveaway était clos.
  let closed = false;
  let announced = 0;
  const svc = new GiveawayService({
    configService: enabled,
    repository: {
      findById: async () => ({ id: "g1", guild_id: "g1", winners_count: 1, active: true, status: "active" }),
      draw: async () => ({ winners: [], entriesTotal: 0, truncated: false }),
      closeIfActive: async () => { closed = true; return true; },
    },
    transport: { announceWinners: async () => { announced += 1; } },
  });

  const res = await svc.draw({ guildId: "g1", giveawayId: "g1" });
  assert.equal(res.ok, false);
  assert.equal(res.code, "GIVEAWAY_NO_PARTICIPANTS");
  assert.equal(closed, false, "le giveaway doit rester ouvert pour que des membres puissent participer");
  assert.equal(announced, 0, "aucun gagnant à annoncer");
});

test("M5 anti-double-tirage : draw refuse un giveaway inactif", async () => {
  let draws = 0;
  let active = true;
  const svc = new GiveawayService({
    configService: enabled,
    repository: {
      findById: async () => ({ id: "g1", guild_id: "g1", channel_id: "c1", title: "prize", winners_count: 1, active, status: active ? "active" : "ended" }),
      draw: async () => { draws += 1; return { winners: ["u1"], entriesTotal: 1, truncated: false }; },
      closeIfActive: async () => { if (!active) return false; active = false; return true; },
    },
  });

  const first = await svc.draw({ guildId: "g1", giveawayId: "g1" });
  assert.equal(first.ok, true);
  assert.equal(draws, 1);

  // Sans la garde, ce second appel tirait une deuxième fois.
  const second = await svc.draw({ guildId: "g1", giveawayId: "g1" });
  assert.equal(second.ok, false);
  assert.equal(second.code, "GIVEAWAY_CLOSED");
  assert.equal(draws, 1, "le dépôt ne doit pas être rappelé");
});

test("M5 anti-double-tirage : active null ou absent est refusé", async () => {
  for (const active of [null, undefined]) {
    let draws = 0;
    const svc = new GiveawayService({
      configService: enabled,
      repository: {
        findById: async () => ({ id: "g1", guild_id: "g1", active }),
        draw: async () => { draws += 1; return { winners: [] }; },
        closeIfActive: async () => true,
      },
    });
    const res = await svc.draw({ guildId: "g1", giveawayId: "g1" });
    assert.equal(res.code, "GIVEAWAY_CLOSED");
    assert.equal(draws, 0);
  }
});

test("M5 : deux draw concurrents — un seul obtient la clôture et annonce", async () => {
  // Les deux lisent active=true avant que l'un n'écrive : la garde en lecture
  // ne suffit pas. C'est closeIfActive (update conditionnel) qui tranche.
  let announced = 0;
  let closed = false;
  const svc = new GiveawayService({
    configService: enabled,
    repository: {
      findById: async () => ({ id: "g1", guild_id: "g1", channel_id: "c1", title: "p", winners_count: 1, active: true, status: "active" }),
      draw: async () => ({ winners: ["u1"], entriesTotal: 1, truncated: false }),
      closeIfActive: async () => { if (closed) return false; closed = true; return true; },
    },
    transport: { announceWinners: async () => { announced += 1; } },
  });

  const [a, b] = await Promise.all([
    svc.draw({ guildId: "g1", giveawayId: "g1" }),
    svc.draw({ guildId: "g1", giveawayId: "g1" }),
  ]);

  const ok = [a, b].filter((r) => r.ok);
  const closedResult = [a, b].filter((r) => r.code === "GIVEAWAY_CLOSED");
  assert.equal(ok.length, 1, "exactement un tirage doit réussir");
  assert.equal(closedResult.length, 1, "l'autre doit être refusé comme déjà clos");
  assert.equal(announced, 1, "exactement une annonce de gagnants");
});

test("M5 : un échec RÉEL de clôture n'est jamais avalé", async () => {
  // L'ancien `close(id).catch(() => {})` laissait active à true en silence :
  // le giveaway restait tirable indéfiniment et l'échec était invisible.
  let announced = 0;
  const svc = new GiveawayService({
    configService: enabled,
    repository: {
      findById: async () => ({ id: "g1", guild_id: "g1", channel_id: "c1", title: "p", winners_count: 1, active: true, status: "active" }),
      draw: async () => ({ winners: ["u1"], entriesTotal: 1, truncated: false }),
      closeIfActive: async () => { throw Object.assign(new Error("boom"), { code: "57014" }); },
    },
    transport: { announceWinners: async () => { announced += 1; } },
  });

  const res = await svc.draw({ guildId: "g1", giveawayId: "g1" });
  assert.equal(res.ok, false);
  assert.equal(res.code, "GIVEAWAY_DRAW_FAILED");
  assert.equal(announced, 0, "rien ne doit être annoncé tant que la clôture a échoué");
});

test("M5 : la troncature est propagée sans être présentée comme exacte", async () => {
  const svc = new GiveawayService({
    configService: enabled,
    repository: {
      findById: async () => ({ id: "g1", guild_id: "g1", channel_id: "c1", title: "p", winners_count: 1, active: true, status: "active" }),
      draw: async () => ({ winners: ["u1"], entriesTotal: 50000, truncated: true }),
      closeIfActive: async () => true,
    },
  });
  const res = await svc.draw({ guildId: "g1", giveawayId: "g1" });
  assert.equal(res.ok, true);
  assert.equal(res.entriesTruncated, true, "le drapeau doit remonter jusqu'à la commande");
  assert.equal(res.entriesTotal, 50000);
});

test("C1 M5 : join et draw signalent explicitement l'absence de giveaway_entries", async () => {
  const unavailable = Object.assign(new Error("no table"), { code: "GIVEAWAY_ENTRIES_UNAVAILABLE" });
  const svc = new GiveawayService({
    configService: enabled,
    repository: {
      findById: async () => ({ id: "g1", guild_id: "g1", channel_id: "c1", title: "p", active: true, status: "active" }),
      join: async () => { throw unavailable; },
      draw: async () => { throw unavailable; },
      closeIfActive: async () => true,
    },
  });

  // Le code renvoyé distingue « table absente » d'un échec réel.
  assert.equal((await svc.join({ guildId: "g1", giveawayId: "g1", userId: "u1" })).code, "GIVEAWAY_ENTRIES_UNAVAILABLE");
  assert.equal((await svc.draw({ guildId: "g1", giveawayId: "g1" })).code, "GIVEAWAY_ENTRIES_UNAVAILABLE");
});

test("C1 : un échec réel de join n'est pas confondu avec l'absence de table", async () => {
  const svc = new GiveawayService({
    configService: enabled,
    repository: {
      findById: async () => ({ id: "g1", guild_id: "g1", active: true, status: "active" }),
      join: async () => { throw Object.assign(new Error("permission denied"), { code: "42501" }); },
    },
  });
  assert.equal((await svc.join({ guildId: "g1", giveawayId: "g1", userId: "u1" })).code, "GIVEAWAY_JOIN_FAILED");
});

test("M5 : un échec réel de draw n'est pas confondu avec l'absence de table", async () => {
  const svc = new GiveawayService({
    configService: enabled,
    repository: {
      findById: async () => ({ id: "g1", guild_id: "g1", active: true, status: "active" }),
      draw: async () => { throw Object.assign(new Error("permission denied"), { code: "42501" }); },
    },
  });
  assert.equal((await svc.draw({ guildId: "g1", giveawayId: "g1" })).code, "GIVEAWAY_DRAW_FAILED");
});

test("M5 garde-fou : le service n'appelle plus close() sans condition", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const source = fs.readFileSync(path.join(__dirname, "..", "services", "GiveawayService.js"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
  // L'ancien appel avalait tout échec de clôture dans un catch vide.
  assert.equal(/\.close\(/.test(source), false, "close() inconditionnel : la garde anti-double-tirage saute");
  assert.equal(/catch\(\(\) => \{\}\)/.test(source.split("closeIfActive")[1] || ""), false);
  assert.match(source, /closeIfActive/);
});
