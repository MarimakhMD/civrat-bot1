"use strict";

/**
 * C2 — Garde-fou du dépôt Suggestions contre le schéma Supabase réel.
 *
 * public.suggestions (9 colonnes vérifiées) :
 *   id, guild_id, user_id, content, status, upvotes, downvotes,
 *   created_at, updated_at
 *
 * Avant C2, ce dépôt n'était couvert par AUCUN test : les tests de service
 * utilisaient un faux dépôt, donc l'écriture de 5 colonnes inexistantes
 * (author_id, channel_id, message_id, up_votes, down_votes) n'a jamais fait
 * échouer la suite. Ces tests existent pour que ça ne puisse pas se reproduire.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  SupabaseSuggestionRepository,
  SuggestionVotesUnavailableError,
} = require("../persistence/SupabaseSuggestionRepository");

const REPO_SOURCE = fs.readFileSync(
  path.join(__dirname, "../persistence/SupabaseSuggestionRepository.js"),
  "utf8",
);

/** Colonnes réelles de public.suggestions. Source : schéma Supabase vérifié. */
const REAL_COLUMNS = new Set([
  "id", "guild_id", "user_id", "content", "status",
  "upvotes", "downvotes", "created_at", "updated_at",
]);

/**
 * Double PostgREST minimal.
 *
 * Chaque méthode du builder renvoie le même objet (le dépôt enchaîne
 * .select().eq().eq().single()), et la résolution passe par `then` — un double
 * qui résoudrait directement depuis insert() ne journaliserait rien.
 */
function fakeSupabase(responses = []) {
  const calls = [];
  let index = 0;

  function makeQuery(table, op) {
    const query = {
      table,
      op,
      filters: [],
      payload: null,
      columns: "*",
      terminal: null,
      select(cols) { if (cols) query.columns = cols; return query; },
      insert(payload) { query.payload = payload; return query; },
      update(payload) { query.payload = payload; return query; },
      delete() { return query; },
      eq(column, value) { query.filters.push([column, value]); return query; },
      single() { query.terminal = "single"; return query; },
      maybeSingle() { query.terminal = "maybeSingle"; return query; },
      then(resolve, reject) {
        const call = {
          table,
          op,
          filters: query.filters.map(([c, v]) => [c, v]),
          payload: query.payload ? { ...query.payload } : null,
          columns: query.columns,
          terminal: query.terminal,
        };
        calls.push(call);
        const next = responses[index++] || { data: null, error: null };
        return Promise.resolve(next).then(resolve, reject);
      },
    };
    return query;
  }

  return {
    calls,
    from(table) {
      return {
        select: (cols) => makeQuery(table, "select").select(cols),
        insert: (payload) => makeQuery(table, "insert").insert(payload),
        update: (payload) => makeQuery(table, "update").update(payload),
        delete: () => makeQuery(table, "delete"),
      };
    },
  };
}

const postgrestError = (code, message) => ({ code, message, details: null, hint: null });

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

test("create n'écrit que des colonnes réelles de public.suggestions", async () => {
  const supabase = fakeSupabase([{ data: { id: 7 }, error: null }]);
  const repo = new SupabaseSuggestionRepository({ supabase });

  await repo.create({ guildId: "g1", userId: "u1", content: "hello" });

  assert.equal(supabase.calls.length, 1);
  const call = supabase.calls[0];
  assert.equal(call.table, "suggestions");
  assert.equal(call.op, "insert");

  const written = Object.keys(call.payload);
  for (const column of written) {
    assert.ok(REAL_COLUMNS.has(column), `colonne inexistante écrite : ${column}`);
  }
  assert.deepEqual(written.sort(), ["content", "downvotes", "guild_id", "status", "upvotes", "user_id"]);
});

test("create n'écrit aucune des 5 colonnes supprimées par C2", async () => {
  const supabase = fakeSupabase([{ data: { id: 1 }, error: null }]);
  const repo = new SupabaseSuggestionRepository({ supabase });

  await repo.create({ guildId: "g1", userId: "u1", content: "hello" });

  const payload = supabase.calls[0].payload;
  for (const banned of ["author_id", "channel_id", "message_id", "up_votes", "down_votes"]) {
    assert.equal(banned in payload, false, `${banned} ne doit plus être écrit`);
  }
  assert.equal(payload.guild_id, "g1");
  assert.equal(payload.user_id, "u1");
  assert.equal(payload.content, "hello");
  assert.equal(payload.status, "pending");
  assert.equal(payload.upvotes, 0);
  assert.equal(payload.downvotes, 0);
});

test("create propage l'erreur PostgREST au lieu de l'avaler", async () => {
  const failure = postgrestError("42703", 'column "author_id" does not exist');
  const supabase = fakeSupabase([{ data: null, error: failure }]);
  const repo = new SupabaseSuggestionRepository({ supabase });

  const thrown = await repo.create({ guildId: "g1", userId: "u1", content: "hi" })
    .then(() => null, (error) => error);
  // Les dépôts re-lancent l'objet PostgREST brut, pas une instance d'Error.
  assert.equal(thrown, failure);
});

test("findByMessageId a disparu du dépôt (message_id n'existe pas)", () => {
  const repo = new SupabaseSuggestionRepository({ supabase: fakeSupabase() });
  assert.equal(typeof repo.findByMessageId, "undefined");
});

// ---------------------------------------------------------------------------
// vote
// ---------------------------------------------------------------------------

test("vote : premier vote insère puis incrémente upvotes", async () => {
  const supabase = fakeSupabase([
    { data: null, error: null },                                  // 1. vote existant ?
    { data: { suggestion_id: "1", user_id: "u2", value: 1 }, error: null }, // 2. insert
    { data: { upvotes: 0, downvotes: 0 }, error: null },           // 3. lecture compteurs
    { data: null, error: null },                                   // 4. écriture compteurs
  ]);
  const repo = new SupabaseSuggestionRepository({ supabase });

  const result = await repo.vote("1", "u2", 1);

  assert.equal(result.alreadyVoted, false);
  assert.equal(supabase.calls.length, 4);
  assert.equal(supabase.calls[1].table, "suggestion_votes");
  assert.equal(supabase.calls[1].op, "insert");
  const counters = supabase.calls[3];
  assert.equal(counters.table, "suggestions");
  assert.equal(counters.op, "update");
  assert.deepEqual(counters.payload, { upvotes: 1, downvotes: 0 });
});

test("vote : changement de sens ajuste les deux compteurs", async () => {
  const supabase = fakeSupabase([
    { data: { suggestion_id: "1", user_id: "u2", value: -1 }, error: null }, // vote précédent
    { data: { suggestion_id: "1", user_id: "u2", value: 1 }, error: null },  // update
    { data: { upvotes: 3, downvotes: 2 }, error: null },
    { data: null, error: null },
  ]);
  const repo = new SupabaseSuggestionRepository({ supabase });

  const result = await repo.vote("1", "u2", 1);

  assert.equal(result.alreadyVoted, false);
  assert.deepEqual(supabase.calls[3].payload, { upvotes: 4, downvotes: 1 });
});

test("vote : même valeur renvoie alreadyVoted sans aucune écriture", async () => {
  const supabase = fakeSupabase([
    { data: { suggestion_id: "1", user_id: "u2", value: 1 }, error: null },
  ]);
  const repo = new SupabaseSuggestionRepository({ supabase });

  const result = await repo.vote("1", "u2", 1);

  assert.equal(result.alreadyVoted, true);
  assert.equal(supabase.calls.length, 1, "aucune écriture ne doit suivre");
});

test("vote : table suggestion_votes absente (M4) lève SUGGESTION_VOTES_UNAVAILABLE", async () => {
  const supabase = fakeSupabase([
    { data: null, error: postgrestError("42P01", 'relation "public.suggestion_votes" does not exist') },
  ]);
  const repo = new SupabaseSuggestionRepository({ supabase });

  const thrown = await repo.vote("1", "u2", 1).then(() => null, (error) => error);

  assert.ok(thrown instanceof SuggestionVotesUnavailableError);
  assert.equal(thrown.code, "SUGGESTION_VOTES_UNAVAILABLE");
});

test("vote : une erreur PostgREST réelle est propagée telle quelle", async () => {
  const failure = postgrestError("42501", "permission denied for table suggestion_votes");
  const supabase = fakeSupabase([{ data: null, error: failure }]);
  const repo = new SupabaseSuggestionRepository({ supabase });

  const thrown = await repo.vote("1", "u2", 1).then(() => null, (error) => error);

  assert.equal(thrown, failure);
  assert.ok(!(thrown instanceof SuggestionVotesUnavailableError));
});

test("vote : repli textuel accepté seulement sans code, sur la formulation exacte", async () => {
  // Client ne fournissant aucun code : la formulation Postgres exacte suffit.
  const noCode = { message: 'relation "public.suggestion_votes" does not exist' };
  const repoA = new SupabaseSuggestionRepository({ supabase: fakeSupabase([{ data: null, error: noCode }]) });
  const thrownA = await repoA.vote("1", "u2", 1).then(() => null, (error) => error);
  assert.ok(thrownA instanceof SuggestionVotesUnavailableError);

  // Même absence de code, mais message de permission mentionnant la table :
  // ce n'est PAS une table absente.
  const denied = { message: "permission denied for table suggestion_votes" };
  const repoB = new SupabaseSuggestionRepository({ supabase: fakeSupabase([{ data: null, error: denied }]) });
  const thrownB = await repoB.vote("1", "u2", 1).then(() => null, (error) => error);
  assert.equal(thrownB, denied);
});

// ---------------------------------------------------------------------------
// updateStatus / delete
// ---------------------------------------------------------------------------

test("updateStatus écrit status et renvoie la ligne", async () => {
  const supabase = fakeSupabase([{ data: { id: "1", status: "approved" }, error: null }]);
  const repo = new SupabaseSuggestionRepository({ supabase });

  const row = await repo.updateStatus("1", "approved");

  assert.equal(row.status, "approved");
  assert.deepEqual(supabase.calls[0].payload, { status: "approved" });
  assert.deepEqual(supabase.calls[0].filters, [["id", "1"]]);
});

test("delete supprime la suggestion même si suggestion_votes est absente", async () => {
  const supabase = fakeSupabase([
    { data: null, error: null },                                        // suggestions.delete
    { data: null, error: postgrestError("42P01", "relation does not exist") }, // votes.delete
  ]);
  const repo = new SupabaseSuggestionRepository({ supabase });

  // La suppression de la suggestion est effective : un échec du nettoyage des
  // votes ne doit PAS la faire échouer après coup.
  const result = await repo.delete("1");

  assert.deepEqual(result, { deleted: true });
  assert.equal(supabase.calls[0].table, "suggestions");
  assert.equal(supabase.calls[0].op, "delete");
});

test("delete propage l'échec de suppression de la suggestion", async () => {
  const failure = postgrestError("42501", "permission denied");
  const supabase = fakeSupabase([{ data: null, error: failure }]);
  const repo = new SupabaseSuggestionRepository({ supabase });

  const thrown = await repo.delete("1").then(() => null, (error) => error);
  assert.equal(thrown, failure);
});

// ---------------------------------------------------------------------------
// Garde-fou permanent
// ---------------------------------------------------------------------------

test("garde-fou : le dépôt ne référence plus aucune colonne supprimée", () => {
  // Motifs ciblant l'USAGE en code (clé d'objet ou littéral), pas les
  // commentaires qui documentent justement ces anciens noms.
  const banned = [
    /\bauthor_id\s*:/,
    /\bup_votes\s*:/,
    /\bdown_votes\s*:/,
    /\bchannel_id\s*:/,
    /\bmessage_id\s*:/,
    /"author_id"/,
    /"up_votes"/,
    /"down_votes"/,
    /"channel_id"/,
    /"message_id"/,
    /findByMessageId/,
  ];
  for (const pattern of banned) {
    assert.equal(pattern.test(REPO_SOURCE), false, `le dépôt référence encore ${pattern}`);
  }
});

test("garde-fou : le dépôt écrit les compteurs sous leurs noms réels", () => {
  assert.match(REPO_SOURCE, /upvotes/);
  assert.match(REPO_SOURCE, /downvotes/);
  assert.match(REPO_SOURCE, /user_id/);
});

test("constructeur : exige un client supabase", () => {
  assert.throws(() => new SupabaseSuggestionRepository({}), /supabase client/);
  assert.throws(() => new SupabaseSuggestionRepository({ supabase: {} }), /supabase client/);
});
