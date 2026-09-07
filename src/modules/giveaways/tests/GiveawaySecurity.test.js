"use strict";

// ───────────────────────────────────────────────────────────────
// 4G-5 — tests de sécurité du module Giveaways.
//
// Huit familles, correspondant aux contrôles ajoutés en 4G-5 :
//   1. lecture cross-guilde ;
//   2. mise à jour cross-guilde ;
//   3. accès au mauvais parent sur la table enfant ;
//   4. table enfant incapable de contourner le cloisonnement ;
//   5. guildId transmis par tous les appelants ;
//   6. comportement inchangé dans la bonne guilde ;
//   7. fail-closed quand guildId manque ;
//   8. garde applicative ET filtre SQL sont tous deux présents.
//
// Ces tests portent sur le dépôt RÉEL. Le faux client applique les filtres à
// un jeu de lignes en mémoire, ce qui permet d'observer qu'une opération
// cross-guilde ne modifie RIEN. AUCUNE base réelle n'est contactée : ce qui
// est prouvé, ce sont les requêtes que le code émet et leur effet.
// ───────────────────────────────────────────────────────────────

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  SupabaseGiveawayRepository,
  GiveawayNotInGuildError,
} = require("../persistence/SupabaseGiveawayRepository");
const { GiveawayService } = require("../services/GiveawayService");

const GUILD_A = "111111111111111111";
const GUILD_B = "222222222222222222";

/**
 * Double PostgREST qui EXÉCUTE les filtres sur des lignes en mémoire.
 *
 * `single()` sur zéro ligne renvoie une erreur (PGRST116) : c'est le
 * comportement documenté de PostgREST. Cette émulation est déclarée comme
 * telle — rien ici ne prouve le comportement d'une vraie base.
 */
function makeDb(tables) {
  const seen = [];
  const rows = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.map((r) => ({ ...r }))]));

  const client = {
    from(table) {
      return {
        select: (cols, options) => build(table, "select").select(cols, options),
        insert: (payload) => build(table, "insert").insert(payload),
        update: (payload) => build(table, "update").update(payload),
        delete: () => build(table, "delete"),
      };
    },
  };

  function build(table, op) {
    const q = {
      table,
      op,
      payload: null,
      filters: [],
      columns: "*",
      terminal: null,
      select(cols) { if (cols) q.columns = cols; return q; },
      insert(payload) { q.payload = payload; return q; },
      update(payload) { q.payload = payload; return q; },
      delete() { return q; },
      eq(col, val) { q.filters.push([col, val]); return q; },
      order() { return q; },
      range() { return q; },
      single() { q.terminal = "single"; return q; },
      maybeSingle() { q.terminal = "maybeSingle"; return q; },
      then(resolve) {
        seen.push({
          table,
          op,
          filters: q.filters.map(([c, v]) => [c, v]),
          payload: q.payload ? { ...q.payload } : null,
        });
        const store = rows[table] || (rows[table] = []);
        const matched = store.filter((r) => q.filters.every(([c, v]) => String(r[c]) === String(v)));

        if (op === "select") {
          if (q.terminal === "maybeSingle") {
            return Promise.resolve({ data: matched[0] ? { ...matched[0] } : null, error: null }).then(resolve);
          }
          return Promise.resolve({ data: matched.map((r) => ({ ...r })), error: null }).then(resolve);
        }
        if (op === "insert") {
          const row = { ...q.payload };
          store.push(row);
          return Promise.resolve({ data: { ...row }, error: null }).then(resolve);
        }
        if (op === "update") {
          for (const r of matched) Object.assign(r, q.payload);
          if (q.terminal === "single" && matched.length !== 1) {
            return Promise.resolve({ data: null, error: { code: "PGRST116", message: "no row matched" } }).then(resolve);
          }
          return Promise.resolve({ data: matched.map((r) => ({ ...r })), error: null }).then(resolve);
        }
        // delete
        for (const r of matched) store.splice(store.indexOf(r), 1);
        return Promise.resolve({ data: matched.map((r) => ({ ...r })), error: null }).then(resolve);
      },
    };
    return q;
  }

  return { client, seen, rows };
}

const giveawayIn = (guildId, id = "7") => ({
  id, guild_id: guildId, title: "lot", description: "", channel_id: "c1",
  duration: 60, winners_count: 1, requirements: "", active: true,
  status: "active", ends_at: "2030-01-01T00:00:00.000Z",
});

// ───────────────────────────────────────────────────────────────
// 1 · lecture cross-guilde
// ───────────────────────────────────────────────────────────────

test("4G-5: findById ne résout pas le giveaway d'une autre guilde", async () => {
  const { client, seen } = makeDb({ giveaways: [giveawayIn(GUILD_B)] });
  const repo = new SupabaseGiveawayRepository({ supabase: client });

  assert.equal(await repo.findById(GUILD_A, "7"), null, "aucune ligne renvoyée");

  const read = seen.find((c) => c.table === "giveaways" && c.op === "select");
  assert.deepEqual(read.filters, [["guild_id", GUILD_A], ["id", "7"]],
    "guild_id fait partie du WHERE, pas seulement de la vérification applicative");
});

test("4G-5: findById résout bien le giveaway de la bonne guilde", async () => {
  const { client } = makeDb({ giveaways: [giveawayIn(GUILD_A)] });
  const repo = new SupabaseGiveawayRepository({ supabase: client });

  const found = await repo.findById(GUILD_A, "7");
  assert.equal(found.id, "7");
  assert.equal(found.guild_id, GUILD_A);
});

// ───────────────────────────────────────────────────────────────
// 2 · mise à jour cross-guilde
// ───────────────────────────────────────────────────────────────

test("4G-5: closeIfActive d'une autre guilde ne modifie rien", async () => {
  const { client, rows, seen } = makeDb({ giveaways: [giveawayIn(GUILD_B)] });
  const repo = new SupabaseGiveawayRepository({ supabase: client });

  const closed = await repo.closeIfActive(GUILD_A, "7");

  assert.equal(closed, false, "aucune ligne close");
  assert.equal(rows.giveaways[0].active, true, "le giveaway de la guilde B est toujours ouvert");
  assert.equal(rows.giveaways[0].status, "active");

  const update = seen.find((c) => c.op === "update");
  assert.deepEqual(update.filters, [["guild_id", GUILD_A], ["id", "7"], ["active", true]],
    "guild_id ET le CAS active=true sont tous deux dans le WHERE");
});

test("4G-5: closeIfActive dans la bonne guilde fonctionne et garde le CAS", async () => {
  const { client, rows } = makeDb({ giveaways: [giveawayIn(GUILD_A)] });
  const repo = new SupabaseGiveawayRepository({ supabase: client });

  assert.equal(await repo.closeIfActive(GUILD_A, "7"), true);
  assert.equal(rows.giveaways[0].active, false);
  assert.equal(rows.giveaways[0].status, "ended");
  assert.ok(rows.giveaways[0].ended_at, "ended_at est posé");
});

// ───────────────────────────────────────────────────────────────
// 3 + 4 · table enfant : mauvais parent, contournement impossible
// ───────────────────────────────────────────────────────────────

test("4G-5: join sur le giveaway d'une autre guilde est refusé, aucune ligne insérée", async () => {
  const { client, rows, seen } = makeDb({ giveaways: [giveawayIn(GUILD_B)], giveaway_entries: [] });
  const repo = new SupabaseGiveawayRepository({ supabase: client });

  await assert.rejects(
    () => repo.join(GUILD_A, "7", "u1"),
    (error) => {
      assert.ok(error instanceof GiveawayNotInGuildError);
      assert.equal(error.code, "GIVEAWAY_NOT_IN_GUILD");
      return true;
    },
  );

  assert.equal(rows.giveaway_entries.length, 0, "aucune participation insérée");
  assert.deepEqual(seen.filter((c) => c.table === "giveaway_entries"), [],
    "giveaway_entries n'est même pas touché");
  const parentRead = seen.find((c) => c.table === "giveaways");
  assert.deepEqual(parentRead.filters, [["guild_id", GUILD_A], ["id", "7"]],
    "la parenté est vérifiée par une requête scopée, pas par un contrôle applicatif");
});

test("4G-5: listEntries et draw refusent le giveaway d'une autre guilde", async () => {
  for (const [label, invoke] of [
    ["listEntries", (r) => r.listEntries(GUILD_A, "7")],
    ["draw", (r) => r.draw(GUILD_A, "7", { winnersCount: 1 })],
  ]) {
    const { client, rows, seen } = makeDb({
      giveaways: [giveawayIn(GUILD_B)],
      giveaway_entries: [{ giveaway_id: "7", user_id: "victim" }],
    });
    const repo = new SupabaseGiveawayRepository({ supabase: client });

    await assert.rejects(() => invoke(repo), GiveawayNotInGuildError, label);
    assert.equal(rows.giveaway_entries.length, 1, label + " : les participations sont intactes");
    assert.deepEqual(seen.filter((c) => c.table === "giveaway_entries"), [],
      label + " : la table enfant n'est jamais lue");
  }
});

test("4G-5: la table enfant ne peut pas contourner le cloisonnement", async () => {
  // giveaway_entries n'a ni colonne guild_id ni FK : la seule protection est
  // la vérification de parenté. On vérifie qu'elle précède TOUJOURS l'accès.
  const { client, seen } = makeDb({ giveaways: [giveawayIn(GUILD_A)], giveaway_entries: [] });
  const repo = new SupabaseGiveawayRepository({ supabase: client });

  await repo.join(GUILD_A, "7", "u1");

  const first = seen[0];
  assert.equal(first.table, "giveaways", "le premier accès est la vérification de parenté");
  assert.equal(first.filters[0][0], "guild_id", "elle est scopée par guilde");
  assert.equal(seen[1].table, "giveaway_entries", "l'enfant n'est touché qu'ensuite");
});

test("4G-5: join dans la bonne guilde inscrit normalement", async () => {
  const { client, rows } = makeDb({ giveaways: [giveawayIn(GUILD_A)], giveaway_entries: [] });
  const repo = new SupabaseGiveawayRepository({ supabase: client });

  const result = await repo.join(GUILD_A, "7", "u1");

  assert.equal(result.alreadyJoined, false);
  assert.equal(rows.giveaway_entries.length, 1);
  assert.deepEqual(rows.giveaway_entries[0], { giveaway_id: "7", user_id: "u1" });
});

// ───────────────────────────────────────────────────────────────
// 5 · guildId transmis par tous les appelants
// ───────────────────────────────────────────────────────────────

test("4G-5: GiveawayService transmet guildId au dépôt sur tous les chemins", async () => {
  const received = [];
  const repository = {
    create: async (r) => { received.push(["create", r.guildId]); return { ...giveawayIn(r.guildId), ...r }; },
    findById: async (guildId, id) => { received.push(["findById", guildId, id]); return guildId === GUILD_A ? giveawayIn(GUILD_A, id) : null; },
    join: async (guildId, id, userId) => { received.push(["join", guildId, id, userId]); return { alreadyJoined: false }; },
    listEntries: async (guildId, id) => { received.push(["listEntries", guildId, id]); return { entries: [], total: 0, truncated: false }; },
    draw: async (guildId, id) => { received.push(["draw", guildId, id]); return { winners: ["u1"], entriesTotal: 1, truncated: false }; },
    closeIfActive: async (guildId, id) => { received.push(["closeIfActive", guildId, id]); return true; },
  };
  const service = new GiveawayService({
    configService: { read: async () => ({ giveaways_enabled: true }) },
    repository,
  });

  await service.create({ guildId: GUILD_A, channelId: "c1", title: "lot", winnersCount: 1, durationMinutes: 60 });
  await service.join({ guildId: GUILD_A, giveawayId: "7", userId: "u1" });
  await service.draw({ guildId: GUILD_A, giveawayId: "7" });

  for (const [method, guildId] of received) {
    assert.equal(guildId, GUILD_A, method + " : guildId transmis au dépôt");
  }
  const methods = received.map((r) => r[0]);
  for (const expected of ["create", "findById", "join", "draw", "closeIfActive"]) {
    assert.ok(methods.includes(expected), "le chemin " + expected + " a bien été exercé");
  }
});

// ───────────────────────────────────────────────────────────────
// 6 · fail-closed
// ───────────────────────────────────────────────────────────────

test("4G-5: sans guildId, aucune requête n'est émise", async () => {
  let queried = 0;
  const repo = new SupabaseGiveawayRepository({
    supabase: { from: () => { queried += 1; throw new Error("ne doit pas être atteint"); } },
  });

  assert.equal(await repo.findById(null, "7"), null);
  assert.equal(await repo.findById(undefined, "7"), null);
  assert.equal(await repo.findById("", "7"), null);
  await assert.rejects(() => repo.closeIfActive(null, "7"), TypeError);
  await assert.rejects(() => repo.closeIfActive(GUILD_A, null), TypeError);
  await assert.rejects(() => repo.create({ title: "lot", duration: 60, endsAt: "x" }), TypeError);
  await assert.rejects(() => repo.join(null, "7", "u1"), GiveawayNotInGuildError);

  assert.equal(queried, 0, "fail-closed : aucune requête");
});

// ───────────────────────────────────────────────────────────────
// 7 · les deux remparts sont présents
// ───────────────────────────────────────────────────────────────

test("4G-5: la garde applicative est conservée en plus du filtre SQL", async () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const source = fs.readFileSync(path.join(__dirname, "../services/GiveawayService.js"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");

  const guards = source.match(/giveaway\.guild_id !== guildId/g) || [];
  assert.equal(guards.length, 2, "les deux gardes applicatives (join et draw) sont toujours là");

  const repoSource = fs.readFileSync(path.join(__dirname, "../persistence/SupabaseGiveawayRepository.js"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
  assert.ok(repoSource.includes('.eq("guild_id", guildId)'), "le dépôt filtre aussi dans la requête");
});
