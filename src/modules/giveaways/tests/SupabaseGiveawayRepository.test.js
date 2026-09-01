"use strict";

/**
 * C1 — Garde-fou du dépôt Giveaways contre le schéma Supabase réel.
 *
 * public.giveaways (14 colonnes vérifiées) :
 *   id, guild_id, title, description, channel_id, duration, winners_count,
 *   requirements, active, status, ends_at, ended_at, created_at, updated_at
 *
 * Avant C1, ce dépôt n'était couvert par AUCUN test : les tests de service
 * utilisaient un faux dépôt, donc l'écriture de deux colonnes inexistantes
 * (prize, message_id) et l'omission de deux colonnes NOT NULL (title, duration)
 * n'ont jamais fait échouer la suite. Ces tests existent pour que ça ne puisse
 * pas se reproduire.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  SupabaseGiveawayRepository,
  GiveawayEntriesUnavailableError,
} = require("../persistence/SupabaseGiveawayRepository");

const REPO_SOURCE = fs.readFileSync(
  path.join(__dirname, "../persistence/SupabaseGiveawayRepository.js"),
  "utf8",
);

/**
 * Retire les commentaires du source avant le scan du garde-fou.
 *
 * Sans cette étape, le garde-fou signalait à tort la ligne de documentation
 * « L'ancien code n'écrivait que status: "closed" » : il testait la prose qui
 * explique le correctif au lieu du code. Le dépôt ne contient ni « // » ni
 * « /* » à l'intérieur d'un littéral, donc ce retrait est sûr ici.
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
}

const REPO_CODE = stripComments(REPO_SOURCE);

/** Colonnes réelles de public.giveaways. Source : schéma Supabase vérifié. */
const REAL_COLUMNS = new Set([
  "id", "guild_id", "title", "description", "channel_id", "duration",
  "winners_count", "requirements", "active", "status", "ends_at",
  "ended_at", "created_at", "updated_at",
]);

/**
 * Double PostgREST minimal.
 *
 * Chaque méthode du builder renvoie le même objet (le dépôt enchaîne
 * .insert().select().single()), et la résolution passe par `then` — un double
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
        calls.push({
          table,
          op,
          filters: query.filters.map(([c, v]) => [c, v]),
          payload: query.payload ? { ...query.payload } : null,
          columns: query.columns,
          terminal: query.terminal,
        });
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

const validCreate = {
  guildId: "g1",
  channelId: "c1",
  title: "Clavier mécanique",
  winnersCount: 2,
  duration: 1440,
  endsAt: "2026-09-08T12:00:00.000Z",
};

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

test("create n'écrit que des colonnes réelles de public.giveaways", async () => {
  const supabase = fakeSupabase([{ data: { id: 7 }, error: null }]);
  const repo = new SupabaseGiveawayRepository({ supabase });

  await repo.create(validCreate);

  assert.equal(supabase.calls.length, 1);
  const call = supabase.calls[0];
  assert.equal(call.table, "giveaways");
  assert.equal(call.op, "insert");

  for (const column of Object.keys(call.payload)) {
    assert.ok(REAL_COLUMNS.has(column), `colonne inexistante écrite : ${column}`);
  }
});

test("create écrit title ET duration, les deux colonnes NOT NULL", async () => {
  const supabase = fakeSupabase([{ data: { id: 1 }, error: null }]);
  const repo = new SupabaseGiveawayRepository({ supabase });

  await repo.create(validCreate);

  const payload = supabase.calls[0].payload;
  assert.equal(payload.title, "Clavier mécanique");
  assert.equal(payload.duration, 1440);
  assert.equal(payload.ends_at, "2026-09-08T12:00:00.000Z");
  assert.equal(payload.guild_id, "g1");
  assert.equal(payload.channel_id, "c1");
  assert.equal(payload.winners_count, 2);
});

test("create n'écrit ni prize ni message_id, colonnes inexistantes", async () => {
  const supabase = fakeSupabase([{ data: { id: 1 }, error: null }]);
  const repo = new SupabaseGiveawayRepository({ supabase });

  await repo.create(validCreate);

  const payload = supabase.calls[0].payload;
  for (const banned of ["prize", "message_id"]) {
    assert.equal(banned in payload, false, `${banned} ne doit plus être écrit`);
  }
});

test("create écrit status='active' et active=true, jamais 'open'", async () => {
  const supabase = fakeSupabase([{ data: { id: 1 }, error: null }]);
  const repo = new SupabaseGiveawayRepository({ supabase });

  await repo.create(validCreate);

  const payload = supabase.calls[0].payload;
  assert.equal(payload.status, "active");
  assert.equal(payload.active, true);
  assert.notEqual(payload.status, "open");
});

test("create renseigne les défauts réels description et requirements", async () => {
  const supabase = fakeSupabase([{ data: { id: 1 }, error: null }]);
  const repo = new SupabaseGiveawayRepository({ supabase });

  await repo.create(validCreate);

  const payload = supabase.calls[0].payload;
  assert.equal(payload.description, "");
  assert.equal(payload.requirements, "");
});

test("create refuse title, duration ou endsAt manquants avant tout appel réseau", async () => {
  const supabase = fakeSupabase([]);
  const repo = new SupabaseGiveawayRepository({ supabase });

  await assert.rejects(() => repo.create({ ...validCreate, title: "" }), /title/);
  await assert.rejects(() => repo.create({ ...validCreate, duration: undefined }), /duration/);
  await assert.rejects(() => repo.create({ ...validCreate, endsAt: null }), /endsAt/);

  assert.equal(supabase.calls.length, 0, "aucune requête ne doit partir");
});

test("create propage l'erreur PostgREST au lieu de l'avaler", async () => {
  const failure = postgrestError("42703", 'column "prize" does not exist');
  const supabase = fakeSupabase([{ data: null, error: failure }]);
  const repo = new SupabaseGiveawayRepository({ supabase });

  const thrown = await repo.create(validCreate).then(() => null, (error) => error);
  // Les dépôts re-lancent l'objet PostgREST brut, pas une instance d'Error.
  assert.equal(thrown, failure);
});

test("findByMessageId a disparu du dépôt (message_id n'existe pas)", () => {
  const repo = new SupabaseGiveawayRepository({ supabase: fakeSupabase() });
  assert.equal(typeof repo.findByMessageId, "undefined");
});

// ---------------------------------------------------------------------------
// close — anti-double-tirage
// ---------------------------------------------------------------------------

test("close pose status='ended', active=false et ended_at", async () => {
  const supabase = fakeSupabase([{ data: { id: "1", active: false, status: "ended" }, error: null }]);
  const repo = new SupabaseGiveawayRepository({ supabase });

  await repo.close("1");

  const call = supabase.calls[0];
  assert.equal(call.table, "giveaways");
  assert.equal(call.op, "update");
  assert.deepEqual(call.filters, [["id", "1"]]);
  assert.equal(call.payload.status, "ended");
  assert.equal(call.payload.active, false);
  assert.ok(!Number.isNaN(Date.parse(call.payload.ended_at)), "ended_at doit être un horodatage valide");
});

test("close ne laisse PAS active à true — sinon le giveaway resterait tirable", async () => {
  const supabase = fakeSupabase([{ data: {}, error: null }]);
  const repo = new SupabaseGiveawayRepository({ supabase });

  await repo.close("1");

  assert.equal(supabase.calls[0].payload.active, false);
});

// ---------------------------------------------------------------------------
// giveaway_entries — M5 non appliquée
// ---------------------------------------------------------------------------

test("join : table giveaway_entries absente (M5) lève GIVEAWAY_ENTRIES_UNAVAILABLE", async () => {
  const supabase = fakeSupabase([
    { data: null, error: postgrestError("42P01", 'relation "public.giveaway_entries" does not exist') },
  ]);
  const repo = new SupabaseGiveawayRepository({ supabase });

  const thrown = await repo.join("1", "u1").then(() => null, (error) => error);

  assert.ok(thrown instanceof GiveawayEntriesUnavailableError);
  assert.equal(thrown.code, "GIVEAWAY_ENTRIES_UNAVAILABLE");
});

test("listEntries et draw signalent aussi l'absence de giveaway_entries", async () => {
  const missing = { data: null, error: postgrestError("42P01", "relation does not exist") };
  const repoA = new SupabaseGiveawayRepository({ supabase: fakeSupabase([missing]) });
  const thrownA = await repoA.listEntries("1").then(() => null, (error) => error);
  assert.ok(thrownA instanceof GiveawayEntriesUnavailableError);

  const repoB = new SupabaseGiveawayRepository({ supabase: fakeSupabase([missing]) });
  const thrownB = await repoB.draw("1").then(() => null, (error) => error);
  assert.ok(thrownB instanceof GiveawayEntriesUnavailableError);
});

test("join : une erreur PostgREST réelle est propagée telle quelle", async () => {
  const failure = postgrestError("42501", "permission denied for table giveaway_entries");
  const supabase = fakeSupabase([{ data: null, error: failure }]);
  const repo = new SupabaseGiveawayRepository({ supabase });

  const thrown = await repo.join("1", "u1").then(() => null, (error) => error);

  assert.equal(thrown, failure);
  assert.ok(!(thrown instanceof GiveawayEntriesUnavailableError));
});

test("join : repli textuel accepté seulement sans code, sur la formulation exacte", async () => {
  const noCode = { message: 'relation "public.giveaway_entries" does not exist' };
  const repoA = new SupabaseGiveawayRepository({ supabase: fakeSupabase([{ data: null, error: noCode }]) });
  const thrownA = await repoA.join("1", "u1").then(() => null, (error) => error);
  assert.ok(thrownA instanceof GiveawayEntriesUnavailableError);

  // Même absence de code, mais message de permission mentionnant la table :
  // ce n'est PAS une table absente.
  const denied = { message: "permission denied for table giveaway_entries" };
  const repoB = new SupabaseGiveawayRepository({ supabase: fakeSupabase([{ data: null, error: denied }]) });
  const thrownB = await repoB.join("1", "u1").then(() => null, (error) => error);
  assert.equal(thrownB, denied);
});

test("join : violation d'unicité (23505) renvoie alreadyJoined", async () => {
  const supabase = fakeSupabase([{ data: null, error: postgrestError("23505", "duplicate key") }]);
  const repo = new SupabaseGiveawayRepository({ supabase });

  const result = await repo.join("1", "u1");
  assert.deepEqual(result, { alreadyJoined: true });
});

// ---------------------------------------------------------------------------
// Garde-fou permanent
// ---------------------------------------------------------------------------

test("garde-fou : le dépôt ne référence plus prize, message_id ni findByMessageId", () => {
  // Scan du CODE, commentaires retirés : la documentation du correctif cite
  // volontairement ces anciens noms, elle ne doit pas déclencher le garde-fou.
  const banned = [
    /\bprize\s*:/,
    /\bmessage_id\s*:/,
    /"prize"/,
    /"message_id"/,
    /findByMessageId/,
    /status:\s*"open"/,
    /status:\s*"closed"/,
    /updateMessageId/,
  ];
  for (const pattern of banned) {
    assert.equal(pattern.test(REPO_CODE), false, `le dépôt référence encore ${pattern}`);
  }
});

test("garde-fou : le dépôt écrit les colonnes réelles attendues", () => {
  // Vérifié dans le CODE, pas dans les commentaires : cela prouve que chaque
  // colonne est réellement écrite et pas seulement mentionnée.
  for (const expected of ["title", "duration", "ends_at", "requirements", "winners_count", "active", "ended_at"]) {
    assert.match(REPO_CODE, new RegExp(`\\b${expected}\\b`), `colonne réelle absente du code : ${expected}`);
  }
});

test("constructeur : exige un client supabase", () => {
  assert.throws(() => new SupabaseGiveawayRepository({}), /supabase client/);
  assert.throws(() => new SupabaseGiveawayRepository({ supabase: {} }), /supabase client/);
});
