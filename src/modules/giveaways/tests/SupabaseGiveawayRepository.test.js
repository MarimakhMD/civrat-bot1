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
  ENTRIES_PAGE_SIZE,
  ENTRIES_SCAN_CAP,
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
      orders: [],
      rangeBounds: null,
      select(cols) { if (cols) query.columns = cols; return query; },
      insert(payload) { query.payload = payload; return query; },
      update(payload) { query.payload = payload; return query; },
      delete() { return query; },
      eq(column, value) { query.filters.push([column, value]); return query; },
      order(column, options) { query.orders.push([column, options || null]); return query; },
      range(from, to) { query.rangeBounds = [from, to]; return query; },
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
          orders: query.orders.map(([c, o]) => [c, o]),
          range: query.rangeBounds ? [...query.rangeBounds] : null,
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

test("closeIfActive pose les 3 champs de clôture ET la condition active=true", async () => {
  const supabase = fakeSupabase([{ data: [{ id: "1", active: false, status: "ended" }], error: null }]);
  const repo = new SupabaseGiveawayRepository({ supabase });

  const closed = await repo.closeIfActive("1");

  assert.equal(closed, true);
  const call = supabase.calls[0];
  assert.equal(call.table, "giveaways");
  assert.equal(call.op, "update");
  // La condition .eq("active", true) est ce qui rend la clôture atomique :
  // c'est elle qui fait renvoyer 0 ligne à un second draw concurrent.
  assert.deepEqual(call.filters, [["id", "1"], ["active", true]]);
  assert.equal(call.payload.status, "ended");
  assert.equal(call.payload.active, false);
  assert.ok(!Number.isNaN(Date.parse(call.payload.ended_at)), "ended_at doit être un horodatage valide");
});

test("closeIfActive renvoie false quand le giveaway est déjà clos", async () => {
  // 0 ligne mise à jour = un autre draw (ou une clôture manuelle) a gagné.
  const supabase = fakeSupabase([{ data: [], error: null }]);
  const repo = new SupabaseGiveawayRepository({ supabase });

  assert.equal(await repo.closeIfActive("1"), false);
});

test("closeIfActive propage une erreur réelle au lieu de la cacher", async () => {
  const failure = postgrestError("57014", "canceling statement due to statement timeout");
  const supabase = fakeSupabase([{ data: null, error: failure }]);
  const repo = new SupabaseGiveawayRepository({ supabase });

  const thrown = await repo.closeIfActive("1").then(() => null, (error) => error);
  assert.equal(thrown, failure);
});

test("closeIfActive ne laisse PAS active à true — sinon le giveaway resterait tirable", async () => {
  const supabase = fakeSupabase([{ data: [{}], error: null }]);
  const repo = new SupabaseGiveawayRepository({ supabase });

  await repo.closeIfActive("1");

  assert.equal(supabase.calls[0].payload.active, false);
});

test("close() inconditionnel a disparu du dépôt", () => {
  // Un close() sans condition, appelé dans un catch vide, laissait active à true
  // en silence : le giveaway restait tirable indéfiniment.
  assert.equal(/async\s+close\s*\(/.test(REPO_CODE), false);
  assert.match(REPO_CODE, /closeIfActive/);
});

// ---------------------------------------------------------------------------
// giveaway_entries — M5 appliquée
// ---------------------------------------------------------------------------

test("join insère exactement les 2 colonnes réelles de giveaway_entries", async () => {
  const supabase = fakeSupabase([
    { data: { giveaway_id: "1", user_id: "u1" }, error: null },
  ]);
  const repo = new SupabaseGiveawayRepository({ supabase });

  const result = await repo.join("1", "u1");

  assert.equal(result.alreadyJoined, false);
  const call = supabase.calls[0];
  assert.equal(call.table, "giveaway_entries");
  assert.equal(call.op, "insert");
  // Ni guild_id (dupliquerait giveaways.guild_id), ni created_at (défaut now()).
  assert.deepEqual(Object.keys(call.payload).sort(), ["giveaway_id", "user_id"]);
  assert.deepEqual(call.payload, { giveaway_id: "1", user_id: "u1" });
});

test("join refuse giveawayId ou userId manquant avant tout appel réseau", async () => {
  const supabase = fakeSupabase([]);
  const repo = new SupabaseGiveawayRepository({ supabase });

  await assert.rejects(() => repo.join(undefined, "u1"), /giveawayId/);
  await assert.rejects(() => repo.join("", "u1"), /giveawayId/);
  await assert.rejects(() => repo.join("1", ""), /userId/);
  await assert.rejects(() => repo.join("1", undefined), /userId/);
  assert.equal(supabase.calls.length, 0, "aucune requête ne doit partir");
});

test("listEntries : table giveaway_entries inaccessible lève GIVEAWAY_ENTRIES_UNAVAILABLE", async () => {
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

test("join : le 23505 n'est traduit QUE sur l'insert", async () => {
  // Sur un update, un 23505 signalerait autre chose et doit remonter :
  // l'avaler masquerait une vraie anomalie de schéma.
  const failure = postgrestError("23505", "duplicate key value");
  const supabase = fakeSupabase([{ data: null, error: failure }]);
  const repo = new SupabaseGiveawayRepository({ supabase });

  const thrown = await repo.closeIfActive("1").then(() => null, (error) => error);
  assert.equal(thrown, failure);
});

// ---------------------------------------------------------------------------
// listEntries — pagination (décision K5)
// ---------------------------------------------------------------------------

const page = (n, offset = 0) => ({
  data: Array.from({ length: n }, (_, i) => ({ user_id: `u${offset + i}` })),
  error: null,
});

test("listEntries paginé : 1200 participations → 1200, aucune troncature silencieuse", async () => {
  // Sans .range(), PostgREST applique db-max-rows (1000) et les 200 derniers
  // participants disparaissaient du tirage SANS AUCUNE ERREUR.
  const supabase = fakeSupabase([page(ENTRIES_PAGE_SIZE, 0), page(200, 1000)]);
  const repo = new SupabaseGiveawayRepository({ supabase });

  const { entries, total, truncated } = await repo.listEntries("1");

  assert.equal(entries.length, 1200);
  assert.equal(total, 1200);
  assert.equal(truncated, false);
  assert.equal(supabase.calls.length, 2, "deux lots de 1000 puis 200");
  assert.deepEqual(supabase.calls[0].range, [0, ENTRIES_PAGE_SIZE - 1]);
  assert.deepEqual(supabase.calls[1].range, [ENTRIES_PAGE_SIZE, 2 * ENTRIES_PAGE_SIZE - 1]);
});

test("listEntries impose un ORDER BY stable — sinon la pagination saute des lignes", async () => {
  // Sans ORDER BY, Postgres ne garantit aucun ordre d'une page à l'autre :
  // une pagination sur un ordre instable peut sauter ou dupliquer des lignes.
  const supabase = fakeSupabase([page(3)]);
  const repo = new SupabaseGiveawayRepository({ supabase });

  await repo.listEntries("1");

  const orders = supabase.calls[0].orders.map(([column]) => column);
  assert.deepEqual(orders, ["created_at", "user_id"]);
  assert.deepEqual(supabase.calls[0].filters, [["giveaway_id", "1"]]);
  assert.equal(supabase.calls[0].columns, "user_id");
});

test("listEntries : au plafond de 50 000, truncated=true et total est un PLANCHER", async () => {
  const fullPage = page(ENTRIES_PAGE_SIZE);
  const supabase = fakeSupabase(Array.from({ length: 60 }, () => fullPage));
  const repo = new SupabaseGiveawayRepository({ supabase });

  const { entries, total, truncated } = await repo.listEntries("1");

  assert.equal(truncated, true, "le plafond doit être signalé");
  assert.equal(total, ENTRIES_SCAN_CAP);
  assert.equal(entries.length, ENTRIES_SCAN_CAP);
  assert.equal(supabase.calls.length, ENTRIES_SCAN_CAP / ENTRIES_PAGE_SIZE, "la lecture s'arrête au plafond");
});

test("listEntries : 0 participation renvoie une liste vide, non tronquée", async () => {
  const supabase = fakeSupabase([{ data: [], error: null }]);
  const repo = new SupabaseGiveawayRepository({ supabase });

  const result = await repo.listEntries("1");
  assert.deepEqual(result, { entries: [], total: 0, truncated: false });
});

// ---------------------------------------------------------------------------
// draw — tirage au sort (décisions K2, K3, K4)
// ---------------------------------------------------------------------------

/** Double renvoyant toujours les mêmes lignes, pour les tests statistiques. */
function fixedEntriesSupabase(rows) {
  const query = {
    select() { return query; },
    eq() { return query; },
    order() { return query; },
    range() { return query; },
    then(resolve) { return Promise.resolve({ data: rows, error: null }).then(resolve); },
  };
  return { from: () => ({ select: () => query }) };
}

test("draw : 0 participant renvoie une liste vide", async () => {
  const supabase = fakeSupabase([{ data: [], error: null }]);
  const repo = new SupabaseGiveawayRepository({ supabase });

  const result = await repo.draw("1", { winnersCount: 3 });
  assert.deepEqual(result.winners, []);
  assert.equal(result.entriesTotal, 0);
});

test("draw : participants < winners_count → tous les disponibles sont tirés (K3)", async () => {
  const supabase = fakeSupabase([page(2)]);
  const repo = new SupabaseGiveawayRepository({ supabase });

  const result = await repo.draw("1", { winnersCount: 5 });

  assert.equal(result.winners.length, 2, "pas de gagnant fantôme, pas d'erreur");
  assert.deepEqual([...result.winners].sort(), ["u0", "u1"]);
});

test("draw : winners_count absent, nul ou invalide retombe sur 1 (défaut réel de la colonne)", async () => {
  for (const winnersCount of [undefined, null, 0, -3, "abc"]) {
    const supabase = fakeSupabase([page(4)]);
    const repo = new SupabaseGiveawayRepository({ supabase });
    const result = await repo.draw("1", { winnersCount });
    assert.equal(result.winners.length, 1, `winners_count=${String(winnersCount)}`);
  }
});

test("draw : winners_count fractionnaire est tronqué, jamais arrondi au supérieur", async () => {
  const supabase = fakeSupabase([page(10)]);
  const repo = new SupabaseGiveawayRepository({ supabase });

  const result = await repo.draw("1", { winnersCount: 2.9 });
  assert.equal(result.winners.length, 2);
});

test("draw : le mélange est équiprobable (Fisher–Yates, pas sort(random))", async () => {
  // L'ancien [...entries].sort(() => Math.random() - 0.5) donnait, mesuré sur
  // 200 000 tirages à 5 participants : 32,41 % / 12,31 % — un écart de 2,63×
  // pour 20 % attendus. Un tirage de giveaway biaisé de 2,6× n'est pas
  // défendable. Fisher–Yates + crypto.randomInt doit ramener l'écart près de 1.
  const rows = ["A", "B", "C", "D", "E"].map((user_id) => ({ user_id }));
  const repo = new SupabaseGiveawayRepository({ supabase: fixedEntriesSupabase(rows) });
  const N = 20000;
  const first = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  for (let i = 0; i < N; i++) {
    const { winners } = await repo.draw("1", { winnersCount: 1 });
    first[winners[0]] += 1;
  }
  const shares = Object.values(first).map((c) => (100 * c) / N);
  const ratio = Math.max(...shares) / Math.min(...shares);
  assert.ok(
    ratio < 1.6,
    `tirage biaisé : écart max/min de ${ratio.toFixed(2)}× (parts ${shares.map((s) => s.toFixed(1)).join(" / ")} %)`,
  );
});

test("draw : tous les participants restent éligibles", async () => {
  // Un mélange peut aussi « oublier » des éléments. Vérifié sur les positions.
  const rows = ["A", "B", "C"].map((user_id) => ({ user_id }));
  const repo = new SupabaseGiveawayRepository({ supabase: fixedEntriesSupabase(rows) });
  const seen = new Set();
  for (let i = 0; i < 300; i++) {
    const { winners } = await repo.draw("1", { winnersCount: 3 });
    assert.equal(winners.length, 3);
    assert.deepEqual([...winners].sort(), ["A", "B", "C"], "aucun participant perdu ni dupliqué");
    seen.add(winners.join(""));
  }
  assert.ok(seen.size >= 4, `seulement ${seen.size} permutations observées sur 6 possibles`);
});

test("draw ne lit plus le giveaway : winners_count vient du service", async () => {
  // L'ancien draw() rappelait findById(), donc une seconde lecture inutile.
  const supabase = fakeSupabase([page(2)]);
  const repo = new SupabaseGiveawayRepository({ supabase });

  await repo.draw("1", { winnersCount: 2 });

  assert.equal(supabase.calls.filter((c) => c.table === "giveaways").length, 0);
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

test("garde-fou : aucun mélange par sort(random) ne peut revenir", () => {
  // Un comparateur aléatoire viole la relation d'ordre total attendue par
  // sort() : la permutation résultante n'a aucune raison d'être équiprobable.
  // Mesuré à 2,63× d'écart entre participants sur un tirage à 5.
  assert.equal(/sort\(\s*\(\s*\)\s*=>\s*Math\.random\(\)/.test(REPO_CODE), false);
  assert.equal(/\.sort\(\s*\(\s*[a-z]\s*,\s*[a-z]\s*\)\s*=>\s*Math\.random/.test(REPO_CODE), false);
  assert.match(REPO_CODE, /randomInt/, "le tirage doit passer par crypto.randomInt");
  assert.equal(/Math\.random\(\)/.test(REPO_CODE), false, "Math.random est prévisible par un participant");
});

test("garde-fou : listEntries reste paginé et plafonné", () => {
  // Un select sans .range() est tronqué silencieusement par db-max-rows.
  assert.match(REPO_CODE, /\.range\(/);
  assert.match(REPO_CODE, /\.order\(/, "sans ORDER BY stable, la pagination saute des lignes");
  assert.match(REPO_CODE, /truncated/);
  assert.equal(ENTRIES_SCAN_CAP, 50000, "plafond fixé par la décision K5");
  assert.equal(ENTRIES_PAGE_SIZE, 1000);
});

test("garde-fou : la clôture reste conditionnelle à active=true", () => {
  assert.match(REPO_CODE, /\.eq\("active",\s*true\)/);
  // Aucune RPC : l'update conditionnel suffit à rendre la garde atomique.
  assert.equal(/\.rpc\(/.test(REPO_CODE), false, "aucune RPC ne doit être introduite");
});

test("garde-fou : giveaway_entries n'écrit aucune colonne hors schéma réel", () => {
  // Schéma M5 vérifié : giveaway_id, user_id, created_at — 3 colonnes.
  // Pas de guild_id (dupliquerait giveaways.guild_id), pas d'id surrogate.
  const forbidden = [/\bguild_id\s*:\s*userId/, /giveaway_entries"?\)?[\s\S]{0,120}\bid\s*:/];
  for (const pattern of forbidden) {
    assert.equal(pattern.test(REPO_CODE), false, `le dépôt écrit une colonne hors schéma (${pattern})`);
  }
});

test("constructeur : exige un client supabase", () => {
  assert.throws(() => new SupabaseGiveawayRepository({}), /supabase client/);
  assert.throws(() => new SupabaseGiveawayRepository({ supabase: {} }), /supabase client/);
});
