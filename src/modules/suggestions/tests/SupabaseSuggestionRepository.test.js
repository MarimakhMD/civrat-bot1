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

/**
 * Retire les commentaires du source avant le scan des garde-fous.
 *
 * Sans cette étape, un garde-fou signalait à tort la ligne de documentation
 * « le code comparait `existing.value === value` de façon STRICTE » : il testait
 * la prose qui explique le correctif au lieu du code. C'est exactement le défaut
 * déjà rencontré et corrigé sur le garde-fou du dépôt Giveaways.
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
}

const REPO_CODE = stripComments(REPO_SOURCE);

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
      select(cols, options) { if (cols) query.columns = cols; if (options) query.options = { ...options }; return query; },
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
        options: query.options || null,
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
        select: (cols, options) => makeQuery(table, "select").select(cols, options),
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

test("vote : premier vote insère puis RECALCULE les compteurs", async () => {
  const supabase = fakeSupabase([
    { data: null, error: null },                                              // 1. vote existant ?
    { data: { suggestion_id: "1", user_id: "u2", value: 1 }, error: null },   // 2. insert
    { data: null, error: null, count: 1 },                                    // 3. count value = 1
    { data: null, error: null, count: 0 },                                    // 4. count value = -1
    { data: null, error: null },                                              // 5. écriture compteurs
  ]);
  const repo = new SupabaseSuggestionRepository({ supabase });

  const result = await repo.vote("1", "u2", 1);

  assert.equal(result.alreadyVoted, false);
  assert.equal(supabase.calls.length, 5);
  assert.equal(supabase.calls[1].table, "suggestion_votes");
  assert.equal(supabase.calls[1].op, "insert");
  const counters = supabase.calls[4];
  assert.equal(counters.table, "suggestions");
  assert.equal(counters.op, "update");
  assert.deepEqual(counters.payload, { upvotes: 1, downvotes: 0 });
});

test("vote : les compteurs sont RECALCULÉS, jamais incrémentés", async () => {
  const supabase = fakeSupabase([
    { data: { suggestion_id: "1", user_id: "u2", value: -1 }, error: null },  // vote précédent
    { data: { suggestion_id: "1", user_id: "u2", value: 1 }, error: null },   // update du vote
    { data: null, error: null, count: 4 },                                    // upvotes recalculé
    { data: null, error: null, count: 1 },                                    // downvotes recalculé
    { data: null, error: null },
  ]);
  const repo = new SupabaseSuggestionRepository({ supabase });

  const result = await repo.vote("1", "u2", 1);

  assert.equal(result.alreadyVoted, false);
  // Les valeurs écrites proviennent du comptage, pas d'un ancien +1.
  assert.deepEqual(supabase.calls[4].payload, { upvotes: 4, downvotes: 1 });

  // Preuve décisive : suggestions n'est JAMAIS lu avant écriture. L'ancienne
  // implémentation faisait select("upvotes, downvotes") puis update — c'est ce
  // lecture-modification-écriture qui perdait des votes en concurrence.
  const reads = supabase.calls.filter((c) => c.table === "suggestions" && c.op === "select");
  assert.equal(reads.length, 0, "aucune lecture de suggestions ne doit précéder l'écriture");
});

test("vote : deux votes concurrents de membres différents donnent des compteurs exacts", async () => {
  // Membres A puis B. Chacun recalcule depuis suggestion_votes : la seconde
  // écriture voit le vote du premier. Avec l'ancien incrément, B aurait pu lire
  // upvotes avant que l'écriture de A soit visible et écraser son vote.
  const supabase = fakeSupabase([
    { data: null, error: null },                                              // A : vote existant ?
    { data: { suggestion_id: "1", user_id: "A", value: 1 }, error: null },    // A : insert
    { data: null, error: null, count: 1 },
    { data: null, error: null, count: 0 },
    { data: null, error: null },                                              // A : écriture
    { data: null, error: null },                                              // B : vote existant ?
    { data: { suggestion_id: "1", user_id: "B", value: 1 }, error: null },    // B : insert
    { data: null, error: null, count: 2 },
    { data: null, error: null, count: 0 },
    { data: null, error: null },                                              // B : écriture
  ]);
  const repo = new SupabaseSuggestionRepository({ supabase });

  await repo.vote("1", "A", 1);
  await repo.vote("1", "B", 1);

  const writes = supabase.calls.filter((c) => c.table === "suggestions" && c.op === "update");
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[0].payload, { upvotes: 1, downvotes: 0 });
  // Aucune dérive : le second vote n'a pas écrasé le premier.
  assert.deepEqual(writes[1].payload, { upvotes: 2, downvotes: 0 });
});

test("vote : le comptage utilise HEAD + count=exact, sans transférer de ligne", async () => {
  const supabase = fakeSupabase([
    { data: null, error: null },
    { data: { suggestion_id: "1", user_id: "u2", value: 1 }, error: null },
    { data: null, error: null, count: 7 },
    { data: null, error: null, count: 3 },
    { data: null, error: null },
  ]);
  const repo = new SupabaseSuggestionRepository({ supabase });

  await repo.vote("1", "u2", 1);

  const counts = supabase.calls.filter((c) => c.options && c.options.count === "exact");
  assert.equal(counts.length, 2);
  for (const call of counts) {
    assert.equal(call.options.head, true, "la requête doit être HEAD");
    assert.equal(call.table, "suggestion_votes");
    assert.equal(call.columns, "value");
  }
  assert.deepEqual(counts[0].filters, [["suggestion_id", "1"], ["value", 1]]);
  assert.deepEqual(counts[1].filters, [["suggestion_id", "1"], ["value", -1]]);
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

test("vote : insert concurrent (23505) renvoie alreadyVoted, pas une erreur brute", async () => {
  const supabase = fakeSupabase([
    { data: null, error: null },   // le select ne voit pas encore le vote concurrent
    { data: null, error: postgrestError("23505", 'duplicate key value violates unique constraint "suggestion_votes_pkey"') },
  ]);
  const repo = new SupabaseSuggestionRepository({ supabase });

  const result = await repo.vote("1", "u2", 1);

  // La PK composite (suggestion_id, user_id) a refusé le doublon en base.
  assert.deepEqual(result, { alreadyVoted: true });
  // Le gagnant de la course synchronise les compteurs : aucune écriture ici.
  assert.equal(supabase.calls.length, 2);
});

test("vote : un 23505 sur l'UPDATE n'est pas traité comme alreadyVoted", async () => {
  // Garde de non-régression : le 23505 n'a de sens que sur l'insert. Sur
  // l'update il signalerait autre chose et doit remonter.
  const failure = postgrestError("23505", "duplicate key value");
  const supabase = fakeSupabase([
    { data: { suggestion_id: "1", user_id: "u2", value: -1 }, error: null },
    { data: null, error: failure },
  ]);
  const repo = new SupabaseSuggestionRepository({ supabase });

  const thrown = await repo.vote("1", "u2", 1).then(() => null, (error) => error);
  assert.equal(thrown, failure);
});

test("vote : value smallint renvoyé en CHAÎNE est reconnu comme vote identique", async () => {
  // `value` est un smallint. Si le pilote renvoyait "1" au lieu de 1, l'ancienne
  // comparaison stricte existing.value === value échouait silencieusement :
  // chaque vote était traité comme un changement de sens et les compteurs
  // dérivaient sans aucune erreur visible.
  const supabase = fakeSupabase([
    { data: { suggestion_id: "1", user_id: "u2", value: "1" }, error: null },
  ]);
  const repo = new SupabaseSuggestionRepository({ supabase });

  const result = await repo.vote("1", "u2", 1);

  assert.equal(result.alreadyVoted, true);
  assert.equal(supabase.calls.length, 1, "aucune mise à jour ne doit suivre");
});

test("vote : value chaîne '-1' contre un vote à -1 est aussi reconnu", async () => {
  const supabase = fakeSupabase([
    { data: { suggestion_id: "1", user_id: "u2", value: "-1" }, error: null },
  ]);
  const repo = new SupabaseSuggestionRepository({ supabase });

  assert.equal((await repo.vote("1", "u2", -1)).alreadyVoted, true);
});

test("vote : table suggestion_votes inaccessible lève SUGGESTION_VOTES_UNAVAILABLE", async () => {
  // La table existe depuis M4. Ce garde-fou est CONSERVÉ à dessein : une
  // régression de schéma ou de droits doit rester distinguishable d'un échec
  // réel du vote, et non retomber dans un SUGGESTION_VOTE_FAILED muet.
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
    assert.equal(pattern.test(REPO_CODE), false, `le dépôt référence encore ${pattern}`);
  }
});

test("garde-fou : le dépôt écrit les compteurs sous leurs noms réels", () => {
  assert.match(REPO_CODE, /upvotes/);
  assert.match(REPO_CODE, /downvotes/);
  assert.match(REPO_CODE, /user_id/);
});

test("garde-fou : le lecture-modification-écriture des compteurs ne peut pas revenir", () => {
  // Signature de l'ancien défaut : lire suggestions.upvotes/downvotes avant de
  // les réécrire. Deux votes simultanés lisaient la même valeur et réécrivaient
  // le même résultat — un vote était perdu définitivement, sans erreur.
  assert.equal(
    /select\(\s*["']upvotes,\s*downvotes["']\s*\)/.test(REPO_CODE),
    false,
    "le dépôt relit les compteurs avant de les écrire : dérive garantie en concurrence",
  );
  // Le recalcul doit passer par count=exact, pas par un comptage en JS.
  assert.match(REPO_CODE, /count:\s*"exact"/);
  assert.match(REPO_CODE, /head:\s*true/);
});

test("garde-fou : le 23505 reste géré sur l'insert", () => {
  assert.match(REPO_CODE, /23505/);
  assert.match(REPO_CODE, /alreadyVoted/);
});

test("garde-fou : value est normalisé en nombre avant comparaison", () => {
  // Sans conversion, un smallint renvoyé en chaîne faisait échouer la
  // comparaison stricte et dérivait les compteurs silencieusement.
  assert.match(REPO_CODE, /Number\(/);
  assert.equal(/existing\.value\s*===\s*value/.test(REPO_CODE), false);
});

test("constructeur : exige un client supabase", () => {
  assert.throws(() => new SupabaseSuggestionRepository({}), /supabase client/);
  assert.throws(() => new SupabaseSuggestionRepository({ supabase: {} }), /supabase client/);
});
