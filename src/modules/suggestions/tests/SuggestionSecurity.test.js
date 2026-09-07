"use strict";

// ───────────────────────────────────────────────────────────────
// 4G-5 — tests de sécurité du module Suggestions.
//
// Le cas le plus grave corrigé ici : avant 4G-5, delete() filtrait sur `id`
// seul et renvoyait { deleted: true } INCONDITIONNELLEMENT. Même lorsque la
// ligne parente n'était pas supprimée, le nettoyage partait sur
// .eq("suggestion_id", id) seul — donc les votes d'une suggestion ÉTRANGÈRE
// étaient détruits, sans aucune erreur. C'était le seul chemin du module
// capable de détruire des données d'une autre guilde.
//
// Ces tests portent sur le dépôt RÉEL. Le faux client applique les filtres à
// un jeu de lignes en mémoire. AUCUNE base réelle n'est contactée.
// ───────────────────────────────────────────────────────────────

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  SupabaseSuggestionRepository,
  SuggestionNotInGuildError,
} = require("../persistence/SupabaseSuggestionRepository");
const { SuggestionService } = require("../services/SuggestionService");

const GUILD_A = "111111111111111111";
const GUILD_B = "222222222222222222";

/** Double PostgREST qui exécute les filtres sur des lignes en mémoire. */
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
      options: null,
      terminal: null,
      select(cols, options) { if (cols) q.columns = cols; if (options) q.options = options; return q; },
      insert(payload) { q.payload = payload; return q; },
      update(payload) { q.payload = payload; return q; },
      delete() { return q; },
      eq(col, val) { q.filters.push([col, val]); return q; },
      order() { return q; },
      single() { q.terminal = "single"; return q; },
      maybeSingle() { q.terminal = "maybeSingle"; return q; },
      then(resolve) {
        seen.push({
          table,
          op,
          filters: q.filters.map(([c, v]) => [c, v]),
          payload: q.payload ? { ...q.payload } : null,
          columns: q.columns,
        });
        const store = rows[table] || (rows[table] = []);
        const matched = store.filter((r) => q.filters.every(([c, v]) => String(r[c]) === String(v)));

        if (op === "select") {
          if (q.options && q.options.count === "exact") {
            return Promise.resolve({ data: null, error: null, count: matched.length }).then(resolve);
          }
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
        for (const r of matched) store.splice(store.indexOf(r), 1);
        return Promise.resolve({ data: matched.map((r) => ({ ...r })), error: null }).then(resolve);
      },
    };
    return q;
  }

  return { client, seen, rows };
}

const suggestionIn = (guildId, id = "7") => ({
  id, guild_id: guildId, user_id: "author", content: "une idée",
  status: "pending", upvotes: 0, downvotes: 0,
});

// ───────────────────────────────────────────────────────────────
// 1 · lecture cross-guilde
// ───────────────────────────────────────────────────────────────

test("4G-5: findById ne résout pas la suggestion d'une autre guilde", async () => {
  const { client, seen } = makeDb({ suggestions: [suggestionIn(GUILD_B)] });
  const repo = new SupabaseSuggestionRepository({ supabase: client });

  assert.equal(await repo.findById(GUILD_A, "7"), null);

  const read = seen.find((c) => c.table === "suggestions");
  assert.deepEqual(read.filters, [["guild_id", GUILD_A], ["id", "7"]],
    "guild_id est dans le WHERE, pas seulement dans la garde applicative");
});

test("4G-5: findById résout la suggestion de la bonne guilde", async () => {
  const { client } = makeDb({ suggestions: [suggestionIn(GUILD_A)] });
  const repo = new SupabaseSuggestionRepository({ supabase: client });

  const found = await repo.findById(GUILD_A, "7");
  assert.equal(found.id, "7");
  assert.equal(found.guild_id, GUILD_A);
});

// ───────────────────────────────────────────────────────────────
// 2 · update cross-guilde
// ───────────────────────────────────────────────────────────────

test("4G-5: updateStatus d'une autre guilde échoue et ne modifie rien", async () => {
  const { client, rows, seen } = makeDb({ suggestions: [suggestionIn(GUILD_B)] });
  const repo = new SupabaseSuggestionRepository({ supabase: client });

  await assert.rejects(() => repo.updateStatus(GUILD_A, "7", "approved"),
    (error) => { assert.equal(error.code, "PGRST116"); return true; });

  assert.equal(rows.suggestions[0].status, "pending", "la suggestion étrangère est intacte");
  const update = seen.find((c) => c.op === "update");
  assert.deepEqual(update.filters, [["guild_id", GUILD_A], ["id", "7"]]);
});

test("4G-5: vote sur la suggestion d'une autre guilde n'écrit rien, nulle part", async () => {
  const { client, rows, seen } = makeDb({
    suggestions: [suggestionIn(GUILD_B)],
    suggestion_votes: [],
  });
  const repo = new SupabaseSuggestionRepository({ supabase: client });

  await assert.rejects(() => repo.vote(GUILD_A, "7", "u1", 1), SuggestionNotInGuildError);

  assert.equal(rows.suggestion_votes.length, 0, "aucun vote inscrit");
  assert.equal(rows.suggestions[0].upvotes, 0, "les compteurs étrangers sont intacts");
  assert.deepEqual(seen.filter((c) => c.table === "suggestion_votes"), [],
    "la table enfant n'est jamais touchée");
});

test("4G-5: la réécriture des compteurs est elle aussi scopée par guilde", async () => {
  const { client, rows, seen } = makeDb({ suggestions: [suggestionIn(GUILD_A)], suggestion_votes: [] });
  const repo = new SupabaseSuggestionRepository({ supabase: client });

  await repo.vote(GUILD_A, "7", "u1", 1);

  const counterWrite = seen.filter((c) => c.table === "suggestions" && c.op === "update");
  assert.equal(counterWrite.length, 1, "une seule réécriture des compteurs");
  assert.deepEqual(counterWrite[0].filters, [["guild_id", GUILD_A], ["id", "7"]],
    "l'UPDATE des compteurs porte guild_id");
  assert.equal(rows.suggestions[0].upvotes, 1);
});

// ───────────────────────────────────────────────────────────────
// 3 · DELETE cross-guilde — le cas le plus grave
// ───────────────────────────────────────────────────────────────

test("4G-5: delete d'une autre guilde ne supprime NI la suggestion NI ses votes", async () => {
  const { client, rows, seen } = makeDb({
    suggestions: [suggestionIn(GUILD_B)],
    suggestion_votes: [
      { suggestion_id: "7", user_id: "victim1", value: 1 },
      { suggestion_id: "7", user_id: "victim2", value: -1 },
    ],
  });
  const repo = new SupabaseSuggestionRepository({ supabase: client });

  const result = await repo.delete(GUILD_A, "7");

  // Avant 4G-5 : { deleted: true } inconditionnel, et les 2 votes étrangers
  // étaient détruits par le nettoyage non scopé.
  assert.deepEqual(result, { deleted: false }, "le dépôt signale honnêtement que rien n'a été supprimé");
  assert.equal(rows.suggestions.length, 1, "la suggestion étrangère existe toujours");
  assert.equal(rows.suggestion_votes.length, 2, "les votes étrangers sont INTACTS");
  assert.deepEqual(seen.filter((c) => c.table === "suggestion_votes"), [],
    "le nettoyage des votes n'est jamais lancé");

  const del = seen.find((c) => c.op === "delete");
  assert.deepEqual(del.filters, [["guild_id", GUILD_A], ["id", "7"]],
    "le DELETE porte guild_id dans le WHERE");
});

test("4G-5: delete dans la bonne guilde supprime la suggestion puis ses votes", async () => {
  const { client, rows } = makeDb({
    suggestions: [suggestionIn(GUILD_A)],
    suggestion_votes: [{ suggestion_id: "7", user_id: "u1", value: 1 }],
  });
  const repo = new SupabaseSuggestionRepository({ supabase: client });

  const result = await repo.delete(GUILD_A, "7");

  assert.deepEqual(result, { deleted: true });
  assert.equal(rows.suggestions.length, 0);
  assert.equal(rows.suggestion_votes.length, 0, "le nettoyage a bien eu lieu");
});

// ───────────────────────────────────────────────────────────────
// 4 · table enfant incapable de contourner le cloisonnement
// ───────────────────────────────────────────────────────────────

test("4G-5: la vérification de parenté précède TOUJOURS l'accès à suggestion_votes", async () => {
  const { client, seen } = makeDb({ suggestions: [suggestionIn(GUILD_A)], suggestion_votes: [] });
  const repo = new SupabaseSuggestionRepository({ supabase: client });

  await repo.vote(GUILD_A, "7", "u1", 1);

  assert.equal(seen[0].table, "suggestions", "le premier accès est la vérification de parenté");
  assert.deepEqual(seen[0].filters, [["guild_id", GUILD_A], ["id", "7"]]);
  assert.equal(seen[1].table, "suggestion_votes", "l'enfant n'est touché qu'ensuite");
});

// ───────────────────────────────────────────────────────────────
// 5 · guildId transmis par tous les appelants
// ───────────────────────────────────────────────────────────────

test("4G-5: SuggestionService transmet guildId au dépôt sur tous les chemins", async () => {
  const received = [];
  const repository = {
    create: async (r) => { received.push(["create", r.guildId]); return suggestionIn(r.guildId, "7"); },
    findById: async (guildId, id) => { received.push(["findById", guildId, id]); return guildId === GUILD_A ? suggestionIn(GUILD_A, id) : null; },
    vote: async (guildId, id) => { received.push(["vote", guildId, id]); return { alreadyVoted: false }; },
    updateStatus: async (guildId, id, status) => { received.push(["updateStatus", guildId, id, status]); return suggestionIn(GUILD_A, id); },
    delete: async (guildId, id) => { received.push(["delete", guildId, id]); return { deleted: true }; },
  };
  const service = new SuggestionService({
    configService: { read: async () => ({ suggestions_enabled: true, suggestions_channel_id: "c1" }) },
    repository,
  });

  await service.create({ guildId: GUILD_A, channelId: "c1", authorId: "u1", content: "une idée valable" });
  await service.vote({ guildId: GUILD_A, suggestionId: "7", userId: "u2", value: 1 });
  await service.staffAction({ guildId: GUILD_A, suggestionId: "7", action: "approve", actorId: "staff" });
  await service.staffAction({ guildId: GUILD_A, suggestionId: "7", action: "delete", actorId: "staff" });

  for (const [method, guildId] of received) {
    assert.equal(guildId, GUILD_A, method + " : guildId transmis au dépôt");
  }
  const methods = received.map((r) => r[0]);
  for (const expected of ["create", "findById", "vote", "updateStatus", "delete"]) {
    assert.ok(methods.includes(expected), "le chemin " + expected + " a bien été exercé");
  }
});

test("4G-5: le service signale NOT_FOUND quand le dépôt n'a rien supprimé", async () => {
  const repository = {
    findById: async () => suggestionIn(GUILD_A, "7"),
    delete: async () => ({ deleted: false }),
  };
  const service = new SuggestionService({ configService: { read: async () => ({}) }, repository });

  const result = await service.staffAction({ guildId: GUILD_A, suggestionId: "7", action: "delete", actorId: "staff" });
  assert.equal(result.ok, false);
  assert.equal(result.code, "SUGGESTION_NOT_FOUND", "pas de succès annoncé sur une suppression vide");
});

// ───────────────────────────────────────────────────────────────
// 6 · fail-closed
// ───────────────────────────────────────────────────────────────

test("4G-5: sans guildId, aucune requête n'est émise", async () => {
  let queried = 0;
  const repo = new SupabaseSuggestionRepository({
    supabase: { from: () => { queried += 1; throw new Error("ne doit pas être atteint"); } },
  });

  assert.equal(await repo.findById(null, "7"), null);
  assert.equal(await repo.findById(undefined, "7"), null);
  assert.equal(await repo.findById("", "7"), null);
  await assert.rejects(() => repo.updateStatus(null, "7", "approved"), TypeError);
  await assert.rejects(() => repo.updateStatus(GUILD_A, null, "approved"), TypeError);
  await assert.rejects(() => repo.delete(null, "7"), TypeError);
  await assert.rejects(() => repo.delete(GUILD_A, null), TypeError);
  await assert.rejects(() => repo.create({ userId: "u1", content: "x" }), TypeError);
  await assert.rejects(() => repo.vote(null, "7", "u1", 1), SuggestionNotInGuildError);

  assert.equal(queried, 0, "fail-closed : aucune requête");
});

// ───────────────────────────────────────────────────────────────
// 7 · les deux remparts sont présents
// ───────────────────────────────────────────────────────────────

test("4G-5: la garde applicative est conservée en plus du filtre SQL", async () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const strip = (p) => fs.readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");

  const service = strip(path.join(__dirname, "../services/SuggestionService.js"));
  const guards = service.match(/suggestion\.guild_id !== guildId/g) || [];
  assert.equal(guards.length, 2, "les deux gardes applicatives (vote et staffAction) sont toujours là");

  const repo = strip(path.join(__dirname, "../persistence/SupabaseSuggestionRepository.js"));
  assert.ok(repo.includes('.eq("guild_id", guildId)'), "le dépôt filtre aussi dans la requête");
  // Le DELETE ne doit plus pouvoir partir sans guilde.
  const deleteLine = repo.split("\n").find((l) => l.includes('.delete().eq("guild_id"'));
  assert.ok(deleteLine, "le DELETE porte guild_id dans le WHERE");
});
